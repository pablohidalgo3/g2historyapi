const express = require("express");
const cors = require("cors");
const compression = require("compression");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const playwright = require("playwright");
const { createClient } = require("@libsql/client");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de autenticación API Key
function requireApiKey(req, res, next) {
  const auth = req.get("Authorization") || "";
  const [scheme, key] = auth.split(" ");
  if (scheme !== "Bearer" || key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Configurar cliente Turso
const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH,
});

// Middlewares
app.use(cors());
app.use(compression());
app.use(express.json());

// Inicializar caché en memoria
const memoryCache = {
  years: null,
  players: null,
  playersByYear: new Map(),
  playerByIdOrNickname: new Map(),
  ranking: null, // Caché para el ranking
  rankingTimestamp: null,
  matches: null, // Caché para próximos partidos
  matchesTimestamp: null, // Timestamp de la última petición
};

const CACHE_DURATION = 60 * 60 * 1000;

// Configuración de Swagger
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "G2 Esports Players API",
      version: "1.0.0",
      description:
        "API para gestionar los datos de jugadores y años de G2 Esports",
    },
    servers: [
      {
        url: "https://g2historyapi.fly.dev/",
        description: "Servidor de producción (Fly.io)",
      },
    ],
  },
  apis: ["./server.js"],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Redirigir la ruta raíz a /api-docs
app.get("/", (req, res) => {
  res.redirect(301, "/api-docs");
});

// Endpoint de salud
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Verifica que el servidor esté funcionando
 *     responses:
 *       200:
 *         description: Estado del servidor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-01-21T08:20:20.123Z"
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /matches/sync-dpm:
 *   post:
 *     summary: Sincroniza los partidos de la última semana desde dpm.lol (G2) y los guarda en matches_upcoming
 *     responses:
 *       200:
 *         description: Partidos sincronizados (últimos 7 días, Europe/Madrid)
 */
app.post("/matches/sync-dpm", async (req, res) => {
  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/114.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    const URL = "https://dpm.lol/esport/teams/G2/all/all/all/matches";

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Espera a que rendericen cabeceras de fecha o marcadores
    await Promise.race([
      page.waitForSelector('span.font-bold.text-bl.lg\\:text-bxl.text-black-200', { timeout: 60000 }),
      page.waitForSelector(".tabular-nums", { timeout: 60000 }),
    ]);

    const raw = await page.evaluate(() => {
      const origin = location.origin;
      // Mapa de meses en español
      const MONTHS = {
        ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
        jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
      };

      const sections = Array.from(
        document.querySelectorAll('div.flex.flex-col.w-full.gap-4')
      );

      const out = [];

      for (const sec of sections) {
        const headerEl = sec.querySelector(':scope > span.font-bold.text-bl.lg\\:text-bxl.text-black-200');
        if (!headerEl) continue;
        const headerText = (headerEl.textContent || "").trim().toLowerCase();

        // "miércoles, 22 oct" → día y mes
        const m = headerText.match(/(\d{1,2})\s+([a-zá]+)/i);
        let dayNum = null, monthNum = null;
        if (m) {
          dayNum = parseInt(m[1], 10);
          const monKey = m[2]
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase();
          monthNum = MONTHS[monKey] || MONTHS[monKey.slice(0, 3)] || null;
        }

        const cards = Array.from(
          sec.querySelectorAll(':scope > div.flex.flex-col.gap-8 > div[data-state][id]')
        );

        for (const card of cards) {
          const grid = card.querySelector('div.grid.grid-cols-8.lg\\:grid-cols-12');
          if (!grid) continue;

          // Hora HH:MM
          const left = grid.querySelector('div.min-w-\\[60px\\].lg\\:col-span-3');
          const hh = left?.querySelector('span.text-bm.lg\\:text-hl.font-bold.text-black-200')?.textContent?.trim() || "";
          const mm = left?.querySelector('span.text-bxs.lg\\:text-bm.font-bold.text-black-200')?.textContent?.trim() || "";

          // Centro: equipos + marcador
          const center = grid.querySelector('div.grid.grid-cols-11.lg\\:grid-cols-10.items-center');
          if (!center) continue;

          const a1 = center.querySelector('a:nth-of-type(1)');
          const team1 = a1?.querySelector('.font-bold.text-bm.lg\\:text-bxl')?.textContent?.trim() || null;
          const team1LogoEl = a1?.querySelector('img[alt="Team1"][src]');
          const team1Logo = team1LogoEl ? new URL(team1LogoEl.getAttribute("src"), origin).href : null;

          const scoreEl = center.querySelector('div.col-span-3.lg\\:col-span-2 div.tabular-nums > div');
          const score = (scoreEl?.textContent || "").replace(/\s+/g, "") || "-";

          const a2 = center.querySelector('a:nth-of-type(2)');
          const team2 = a2?.querySelector('.font-bold.text-bm.lg\\:text-bxl')?.textContent?.trim() || null;
          const team2LogoEl = a2?.querySelector('img[alt="Team2"][src]');
          const team2Logo = team2LogoEl ? new URL(team2LogoEl.getAttribute("src"), origin).href : null;

          // Derecha: torneo + fase/BO + logo torneo
          const right = grid.querySelector('div.lg\\:col-span-3');
          const rightText = right?.querySelector('div.hidden.lg\\:flex.flex-col.items-end.font-semibold.text-bm');
          const tournamentName = rightText?.querySelector('span:first-child')?.textContent?.trim() || null;
          const phaseAndBo = rightText?.querySelector('span.text-black-300')?.textContent?.trim() || null;

          const leagueA = right?.querySelector('a[href^="/esport/leagues/"]');
          const tournamentUrl = leagueA ? new URL(leagueA.getAttribute("href"), origin).href : null;
          const leagueLogoEl = leagueA?.querySelector('img[alt="League"][src]');
          const tournamentLogo = leagueLogoEl ? new URL(leagueLogoEl.getAttribute("src"), origin).href : null;

          out.push({
            dayNum,
            monthNum,
            hh,
            mm,
            team1, team1Logo,
            team2, team2Logo,
            score,
            phaseAndBo,
            tournamentName,
            tournamentUrl,
            tournamentLogo,
          });
        }
      }
      return out;
    });

    // ===== Helpers de fecha (sin librerías externas) =====
    const TZ = "Europe/Madrid";

    // offset (ms) para una Date en un timeZone
    function getTzOffsetMs(date, timeZone) {
      const f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const parts = f.formatToParts(date);
      const map = {};
      for (const p of parts) map[p.type] = p.value;
      const asUTC = Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour),
        Number(map.minute),
        Number(map.second)
      );
      return asUTC - date.getTime();
    }

    // Convierte componentes locales (Europe/Madrid) → timestamp real UTC (ms)
    function toZonedTimestamp(year, month, day, hour, minute) {
      const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
      const offset = getTzOffsetMs(guess, TZ);
      return Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
    }

    // "Ahora" y "hace 7 días" en el reloj de Madrid
    function nowInTz(timeZone) {
      const now = new Date();
      const offset = getTzOffsetMs(now, timeZone);
      return new Date(now.getTime() + offset);
    }
    const nowTz = nowInTz(TZ);
    const weekAgoTz = new Date(nowTz.getTime() - 7 * 24 * 60 * 60 * 1000);
    const currentYear = nowTz.getFullYear();

    const parsed = raw
      .map((m) => {
        const day = Number(m.dayNum) || nowTz.getDate();
        const month = Number(m.monthNum) || nowTz.getMonth() + 1;
        const HH = String(m.hh || "00").padStart(2, "0");
        const MM = String(m.mm || "00").padStart(2, "0");

        const ts = toZonedTimestamp(
          currentYear,
          month,
          day,
          Number(HH),
          Number(MM)
        );
        const dtMadrid = new Date(ts);
        const dateISO = new Date(ts).toISOString(); // ISO UTC

        // "Playoffs - BO3" → "BO3"
        const boMatch = (m.phaseAndBo || "").match(/\bBO\d\b/i);
        const bo = boMatch ? boMatch[0].toUpperCase() : null;

        // ID estable: team1-team2-YYYYMMDDTHHMMZ-BOx
        const id = [
          m.team1 || "T1",
          m.team2 || "T2",
          dateISO.replace(/[-:]/g, "").slice(0, 13) + "00Z",
          bo || "BO?"
        ].join("-");

        return {
          id,
          dtMadrid,
          dateISO,
          team1: m.team1,
          team1Logo: m.team1Logo,
          team2: m.team2,
          team2Logo: m.team2Logo,
          score: m.score || "-",
          phaseAndBo: m.phaseAndBo,
          bo,
          tournament_name: m.tournamentName,
          tournament_url: m.tournamentUrl,
          tournament_logo: m.tournamentLogo,
        };
      })
      .filter((r) => r.team1 && r.team2);

    // Filtrado por ventana [weekAgoTz, nowTz] en horario de Madrid
    const lastWeek = parsed.filter((r) => r.dtMadrid >= weekAgoTz && r.dtMadrid <= nowTz);

    // ==== PERSISTENCIA: igual que tu endpoint de Liquipedia (MISMA TABLA/CAMPOS) ====
    // Limpia e inserta en matches_upcoming
    await db.execute("DELETE FROM matches_upcoming");

    for (const m of lastWeek) {
      await db.execute(
        `INSERT INTO matches_upcoming
           (id, team1, team1Logo, team2, team2Logo,
            bo, date, streams_twitch, streams_youtube,
            tournament_name, tournament_url, tournament_logo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          m.team1,
          m.team1Logo,
          m.team2,
          m.team2Logo,
          m.bo,                        // "BO1"/"BO3"/"BO5"
          m.dateISO,                   // fecha en ISO UTC; tu /calendar la parsea bien
          null,                        // streams_twitch (DPM no lo expone)
          null,                        // streams_youtube
          m.tournament_name,
          m.tournament_url,
          m.tournament_logo,
        ]
      );
    }

    res.json({ status: "ok", updated: lastWeek.length });
  } catch (err) {
    console.error("Error en /matches/sync-dpm:", err);
    res.status(500).json({ error: "Error al sincronizar partidos (dpm.lol)" });
  } finally {
    if (browser) await browser.close();
  }
});

// A partir de aquí, protegemos con requireApiKey
app.use(requireApiKey);

// Rutas de la API
/**
 * @swagger
 * /years:
 *   get:
 *     summary: Obtiene todos los años disponibles
 *     responses:
 *       200:
 *         description: Lista de años disponibles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     example: 1
 *                   year:
 *                     type: string
 *                     example: "2024"
 */
app.get("/years", async (req, res) => {
  try {
    if (memoryCache.years) {
      return res.json(memoryCache.years);
    }
    const result = await db.execute("SELECT * FROM years");
    memoryCache.years = result.rows; // Guardar en caché
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener los años:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /players:
 *   get:
 *     summary: Obtiene todos los jugadores
 *     responses:
 *       200:
 *         description: Lista de jugadores
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     example: 1
 *                   nickname:
 *                     type: string
 *                     example: "PlayerOne"
 *                   years:
 *                     type: string
 *                     example: "2023,2024"
 */
app.get("/players", async (req, res) => {
  try {
    if (memoryCache.players) {
      return res.json(memoryCache.players);
    }
    const result = await db.execute("SELECT * FROM players");
    memoryCache.players = result.rows; // Guardar en caché
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener jugadores:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /players/year/{year}:
 *   get:
 *     summary: Obtiene jugadores por año
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema:
 *           type: string
 *         description: Año para filtrar
 *     responses:
 *       200:
 *         description: Lista de jugadores para el año especificado
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     example: 1
 *                   nickname:
 *                     type: string
 *                     example: "PlayerOne"
 *                   years:
 *                     type: string
 *                     example: "2023,2024"
 */
app.get("/players/year/:year", async (req, res) => {
  const { year } = req.params;
  try {
    if (memoryCache.playersByYear.has(year)) {
      return res.json(memoryCache.playersByYear.get(year));
    }
    const result = await db.execute(
      "SELECT * FROM players WHERE years LIKE ?",
      [`%${year}%`]
    );
    memoryCache.playersByYear.set(year, result.rows); // Guardar en caché
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener jugadores por año:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /players/{identifier}:
 *   get:
 *     summary: Obtiene un jugador por ID o nickname
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: ID o nickname del jugador
 *     responses:
 *       200:
 *         description: Información del jugador
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 nickname:
 *                   type: string
 *                   example: "PlayerOne"
 *                 years:
 *                   type: string
 *                   example: "2023,2024"
 *       404:
 *         description: Jugador no encontrado
 */
app.get("/players/:identifier", async (req, res) => {
  const { identifier } = req.params;
  try {
    if (memoryCache.playerByIdOrNickname.has(identifier)) {
      return res.json(memoryCache.playerByIdOrNickname.get(identifier));
    }
    const result = await db.execute(
      "SELECT * FROM players WHERE id = ? OR nickname = ?",
      [identifier, identifier]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Jugador no encontrado" });
    }
    memoryCache.playerByIdOrNickname.set(identifier, result.rows[0]); // Guardar en caché
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al obtener jugador:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /cache/clear:
 *   post:
 *     summary: Limpia manualmente la caché
 *     responses:
 *       200:
 *         description: Caché limpiada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Caché limpiada"
 */
app.post("/cache/clear", (req, res) => {
  memoryCache.years = null;
  memoryCache.players = null;
  memoryCache.playersByYear.clear();
  memoryCache.playerByIdOrNickname.clear();
  memoryCache.ranking = null;
  memoryCache.rankingTimestamp = null;
  memoryCache.matches = null;
  memoryCache.matchesTimestamp = null;
  res.json({ message: "Caché limpiada" });
});

/**
 * @swagger
 * /ranking:
 *   get:
 *     summary: Obtiene el ranking de SoloQ para jugadores de G2 Esports
 *     responses:
 *       200:
 *         description: Lista de jugadores con su posición en el ranking
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   nickname:
 *                     type: string
 *                     example: BrokenBlade
 *                   tier:
 *                     type: string
 *                     example: Challenger
 *                   lp:
 *                     type: integer
 *                     example: 2078
 *                   rank:
 *                     type: integer
 *                     example: 1
 *                   img:
 *                     type: string
 *                     example: "https://opgg-static.akamaized.net/meta/images/profile_icons/profileIcon3220.jpg"
 *       500:
 *         description: Error interno del servidor
 */
app.get("/ranking", async (req, res) => {
  try {
    const now = Date.now();
    if (
      memoryCache.ranking &&
      memoryCache.rankingTimestamp &&
      now - memoryCache.rankingTimestamp < CACHE_DURATION
    ) {
      console.log("Usando caché para el ranking");
      return res.json(memoryCache.ranking);
    }

    const browser = await playwright.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    await page.goto(
      "https://www.op.gg/leaderboards/tier?region=euw&type=ladder&page=1",
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    const rankingData = await page.evaluate(() => {
      const targetNicknames = [
        "g2 brokenblade",
        "g2 skewmond",
        "g2 caps",
        "g2 hans sama",
        "g2 labrov",
      ];

      const players = Array.from(document.querySelectorAll("tr")).filter(
        (row) => {
          const nicknameContainer = row.querySelector(
            "td:nth-child(2) .text-gray-900"
          );
          if (!nicknameContainer) return false;

          const nicknameText = nicknameContainer.textContent
            .trim()
            .toLowerCase();
          return targetNicknames.includes(nicknameText);
        }
      );

      return players.map((row) => {
        const nicknameContainer = row.querySelector(
          "td:nth-child(2) .text-gray-900"
        );
        const nicknameText = nicknameContainer
          ? nicknameContainer.textContent.trim()
          : "Unknown";
        const nickname = nicknameText.replace(/^G2\s+/i, "").trim();

        const tier =
          row.querySelector("td:nth-child(3) div.hidden")?.textContent.trim() ||
          "Unknown";
        const formattedTier = tier.charAt(0).toUpperCase() + tier.slice(1);

        const lpText =
          row
            .querySelector("td:nth-child(4) div")
            ?.textContent.replace(/,/g, "")
            .trim() || "0";
        const lp = parseInt(lpText, 10);

        const rank =
          row.querySelector("td:nth-child(1)")?.textContent.trim() || "Unknown";

        return {
          nickname,
          tier: formattedTier,
          lp,
          rank,
        };
      });
    });

    await browser.close();

    const sortedRankingData = rankingData.sort((a, b) => b.lp - a.lp);
    memoryCache.ranking = sortedRankingData;
    memoryCache.rankingTimestamp = now;
    res.json(sortedRankingData);
  } catch (error) {
    console.error("Error al obtener el ranking:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /matches/sync:
 *   post:
 *     summary: Sincroniza los próximos partidos de G2 Esports desde Liquipedia
 *     responses:
 *       200:
 *         description: Lista de próximos partidos con fecha, rival, torneo y enlace al match
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   opponent:
 *                     type: string
 *                   date:
 *                     type: string
 *                     format: date-time
 *                   rawDate:
 *                     type: string
 *                   tournament:
 *                     type: string
 *                   matchLink:
 *                     type: string
 */
app.post("/matches/sync", async (req, res) => {
  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/114.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    await page.goto("https://liquipedia.net/leagueoflegends/G2_Esports", {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    // 1) Asegurarnos de que el panel "Upcoming Matches" está ya en el DOM
    await page.waitForSelector(".fo-nttax-infobox.panel .infobox-header", {
      timeout: 60000,
    });

    // 2) Scrapeamos cada tabla de partidos
    const matches = await page.evaluate(() => {
      const origin = location.origin;
      // Buscamos el panel por su header
      const panel = Array.from(
        document.querySelectorAll(".fo-nttax-infobox.panel")
      ).find((p) => {
        const hdr = p.querySelector(".infobox-header");
        return hdr?.textContent.trim().includes("Upcoming Matches");
      });
      if (!panel) return [];

      const out = [];
      for (const table of panel.querySelectorAll(
        "table.infobox_matches_content"
      )) {
        const teamRow = table.querySelector("tr:nth-child(1)");
        const infoRow = table.querySelector("tr:nth-child(2)");
        if (!teamRow || !infoRow) continue;

        // — Equipos y logos
        const team1El = teamRow.querySelector(
          "td.team-left .team-template-text a"
        );
        const team2El = teamRow.querySelector(
          "td.team-right .team-template-text a"
        );
        const team1 = team1El?.textContent.trim() || null;
        const team2 = team2El?.textContent.trim() || null;

        const logo1El = teamRow.querySelector(
          "td.team-left .team-template-image-icon img"
        );
        const logo2El = teamRow.querySelector(
          "td.team-right .team-template-image-icon img"
        );
        const team1Logo = logo1El ? new URL(logo1El.src, origin).href : null;
        const team2Logo = logo2El ? new URL(logo2El.src, origin).href : null;

        // — Formato (Bo1, Bo3, Bo5…)
        const boEl = teamRow.querySelector("td.versus .versus-lower abbr");
        const bo = boEl?.textContent.trim() || null;

        // — Fecha (texto + abreviatura de zona)
        const dateEl = infoRow.querySelector(".timer-object-date");
        const date = dateEl?.textContent.trim() || null;

        // — Streams
        const twitchEl = infoRow.querySelector('a[title*="twitch"]');
        const youtubeEl = infoRow.querySelector('a[title*="youtube"]');
        const twitch = twitchEl
          ? new URL(twitchEl.getAttribute("href"), origin).href
          : null;
        const youtube = youtubeEl
          ? new URL(youtubeEl.getAttribute("href"), origin).href
          : null;

        // — Torneo (nombre, URL, logo)
        const tourEl = infoRow.querySelector(".tournament-text-flex a");
        const tourName = tourEl?.textContent.trim() || null;
        const tourUrl = tourEl
          ? new URL(tourEl.getAttribute("href"), origin).href
          : null;
        const tourLogoEl = infoRow.querySelector(
          ".league-icon-small-image img"
        );
        const tourLogo = tourLogoEl
          ? new URL(tourLogoEl.getAttribute("src"), origin).href
          : null;

        if (team1 && team2) {
          out.push({
            id: `${team1}-${team2}-${
              date ? date.replace(/\s+/g, "_") : "unknown"
            }`,
            team1,
            team1Logo,
            team2,
            team2Logo,
            bo,
            date,
            streams: { twitch, youtube },
            tournament: { name: tourName, url: tourUrl, logo: tourLogo },
          });
        }
      }
      return out;
    });

    // Borramos e insertamos en la BD
    await db.execute("DELETE FROM matches_upcoming");
    for (const m of matches) {
      await db.execute(
        `INSERT INTO matches_upcoming
           (id, team1, team1Logo, team2, team2Logo,
            bo, date, streams_twitch, streams_youtube,
            tournament_name, tournament_url, tournament_logo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          m.team1,
          m.team1Logo,
          m.team2,
          m.team2Logo,
          m.bo,
          m.date,
          m.streams.twitch,
          m.streams.youtube,
          m.tournament.name,
          m.tournament.url,
          m.tournament.logo,
        ]
      );
    }

    res.json({ status: "ok", updated: matches.length });
  } catch (err) {
    console.error("Error en /matches/sync:", err);
    res.status(500).json({ error: "Error al sincronizar partidos" });
  } finally {
    if (browser) await browser.close();
  }
});

/**
 * @swagger
 * /matches/upcoming:
 *   get:
 *     summary: Obtiene los próximos partidos de G2 Esports desde la base de datos
 *     description: Devuelve la lista de partidos previamente almacenados en la base de datos mediante sincronización.
 *     responses:
 *       200:
 *         description: Lista de próximos partidos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     example: "G2 Esports-Fnatic-2025_06_20_18:00"
 *                   team1:
 *                     type: string
 *                     example: "G2 Esports"
 *                   team1Logo:
 *                     type: string
 *                     example: "https://liquipedia.net/commons/images/1/12/G2_Esportslogo_std.png"
 *                   team2:
 *                     type: string
 *                     example: "Fnatic"
 *                   team2Logo:
 *                     type: string
 *                     example: "https://liquipedia.net/commons/images/3/3d/Fnaticlogo_std.png"
 *                   bo:
 *                     type: string
 *                     example: "BO5"
 *                   date:
 *                     type: string
 *                     example: "2025-06-20 18:00"
 *                   streams_twitch:
 *                     type: string
 *                     example: "https://twitch.tv/lolesports"
 *                   streams_youtube:
 *                     type: string
 *                     example: "https://youtube.com/lolesports"
 *                   tournament_name:
 *                     type: string
 *                     example: "LEC Summer 2025"
 *                   tournament_url:
 *                     type: string
 *                     example: "https://liquipedia.net/leagueoflegends/LEC/2025/Summer"
 *                   tournament_logo:
 *                     type: string
 *                     example: "https://liquipedia.net/commons/images/7/7c/LEC_Logo_full.png"
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                     example: "2025-06-16T10:20:30.000Z"
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Error interno del servidor"
 */

app.get("/matches/upcoming", async (req, res) => {
  try {
    const result = await db.execute(
      "SELECT * FROM matches_upcoming ORDER BY date"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error al obtener partidos desde BD:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /calendar/{id}:
 *   get:
 *     summary: Devuelve un archivo .ics para un partido
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Archivo .ics del partido
 */
// Express endpoint para servir el .ics con autenticación interna
app.get("/calendar/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // 1) Cargar o refrescar la caché de partidos con API_KEY
    if (!memoryCache.matches) {
      const response = await fetch(
        "https://g2historyapi.fly.dev/matches/upcoming",
        {
          headers: {
            // Asegúrate de definir process.env.API_KEY en tu entorno
            Authorization: `Bearer ${process.env.API_KEY}`,
          },
        }
      );

      if (!response.ok) {
        console.error(
          "Error fetching upcoming matches:",
          response.status,
          response.statusText
        );
        return res
          .status(response.status)
          .json({ error: response.statusText });
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        console.error("Unexpected payload for matches:", data);
        return res
          .status(500)
          .json({ error: "Formato inesperado de datos de partidos" });
      }

      memoryCache.matches = data;
      memoryCache.matchesTimestamp = Date.now();
    }

    // 2) Buscar el partido por ID
    const match = memoryCache.matches.find((m) => m.id === id);
    if (!match) {
      return res.status(404).json({ error: "Partido no encontrado" });
    }

    // 3) Parsear fechas
    const rawDate = match.date
      ?.replace(" - ", " ")
      .replace(/UTC.*$/, "UTC");
    const start = new Date(rawDate);
    if (isNaN(start)) {
      return res.status(400).json({ error: "Fecha inválida" });
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const formatICSDate = (d) =>
      d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    // 4) Construir contenido ICS
    const uid = `${match.id}@g2leaguehistory.online`;
    const summary = `G2 vs ${match.team2} (${
      match.tournament?.name || "Match"
    })`;
    const description = `Best of ${match.bo}. Watch live on: ${
      match.streams?.twitch || match.streams?.youtube || ""
    }`;
    const location = "Online";

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "PRODID:-//G2 Esports//Match Calendar//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `SUMMARY:${summary}`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${formatICSDate(start)}`,
      `DTEND:${formatICSDate(end)}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location}`,
      "STATUS:CONFIRMED",
      "SEQUENCE:0",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    // 5) Enviar el archivo ICS
    res.setHeader("Content-Type", "text/calendar");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="match-${id}.ics"`
    );
    res.send(ics);
  } catch (error) {
    console.error("Error al generar .ics:", error);
    res.status(500).json({ error: "Error interno al generar archivo ICS" });
  }
});


// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});
