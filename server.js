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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    await page.goto("https://liquipedia.net/leagueoflegends/G2_Esports", {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    const matches = await page.evaluate(() => {
      const panel = Array.from(
        document.querySelectorAll(".fo-nttax-infobox.panel")
      ).find(
        (p) =>
          p.querySelector(".infobox-header")?.textContent.trim() ===
          "Upcoming Matches"
      );
      if (!panel) return [];

      const tables = Array.from(
        panel.querySelectorAll("table.infobox_matches_content")
      );
      const out = [];

      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll("tbody > tr"));
        for (let i = 0; i < rows.length - 1; i++) {
          const row = rows[i];
          const nextRow = rows[i + 1];

          const teamLeftCell = row.querySelector("td.team-left");
          const teamRightCell = row.querySelector("td.team-right");

          if (teamLeftCell && teamRightCell) {
            const leftName =
              teamLeftCell
                .querySelector(".team-template-text a")
                ?.textContent.trim() || null;
            const leftLogo = teamLeftCell.querySelector("img")
              ? new URL(
                  teamLeftCell.querySelector("img").getAttribute("src"),
                  location.origin
                ).href
              : null;

            const rightName =
              teamRightCell
                .querySelector(".team-template-text a")
                ?.textContent.trim() || null;
            const rightLogo = teamRightCell.querySelector("img")
              ? new URL(
                  teamRightCell.querySelector("img").getAttribute("src"),
                  location.origin
                ).href
              : null;

            const bo =
              row.querySelector(".versus-lower abbr")?.textContent.trim() ||
              null;

            // Info de la siguiente fila
            const date =
              nextRow.querySelector(".timer-object-date")?.textContent.trim() ||
              null;
            const twitch =
              nextRow.querySelector('a[title*="twitch"]')?.href || null;
            const youtube =
              nextRow.querySelector('a[title*="youtube"]')?.href || null;

            const tourEl = nextRow.querySelector(".tournament-text-flex a");
            const tourName = tourEl?.textContent.trim() || null;
            const tourUrl = tourEl
              ? new URL(tourEl.getAttribute("href"), location.origin).href
              : null;

            const logoEl = nextRow.querySelector(
              ".league-icon-small-image img"
            );
            const tourLogo = logoEl
              ? new URL(logoEl.getAttribute("src"), location.origin).href
              : null;

            out.push({
              id: `${leftName}-${rightName}-${
                date ? date.replace(/\s+/g, "_") : "unknown"
              }`,
              team1: leftName,
              team1Logo: leftLogo,
              team2: rightName,
              team2Logo: rightLogo,
              bo,
              date,
              streams: { twitch, youtube },
              tournament: { name: tourName, url: tourUrl, logo: tourLogo },
            });
          }
        }
      }

      return out;
    });

    // Borrar registros anteriores
    await db.execute("DELETE FROM matches_upcoming");

    // Insertar los nuevos
    for (const match of matches) {
      await db.execute(
        `INSERT INTO matches_upcoming
        (id, team1, team1Logo, team2, team2Logo, bo, date, streams_twitch, streams_youtube, tournament_name, tournament_url, tournament_logo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          match.id,
          match.team1,
          match.team1Logo,
          match.team2,
          match.team2Logo,
          match.bo,
          match.date,
          match.streams.twitch,
          match.streams.youtube,
          match.tournament.name,
          match.tournament.url,
          match.tournament.logo,
        ]
      );
    }

    res.json({ status: "ok", updated: matches.length });
  } catch (err) {
    console.error("Error en /matches/sync:", err.message);
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
app.get("/calendar/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Si no hay partidos en caché, hacer scraping primero
    if (!memoryCache.matches) {
      const response = await fetch(
        "https://g2historyapi.fly.dev/matches/upcoming"
      );
      const data = await response.json();
      memoryCache.matches = data;
      memoryCache.matchesTimestamp = Date.now();
    }

    // Buscar partido por ID
    const match = memoryCache.matches.find((m) => m.id === id);
    if (!match) {
      return res.status(404).json({ error: "Partido no encontrado" });
    }

    // Convertir fecha
    const rawDate = match.date?.replace(" - ", " ").replace(/UTC.*$/, "UTC");
    const start = new Date(rawDate);
    if (isNaN(start)) {
      return res.status(400).json({ error: "Fecha inválida" });
    }

    const end = new Date(start.getTime() + 60 * 60 * 1000); // duración estimada

    const formatICSDate = (d) =>
      d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const uid = `${match.id}@g2leaguehistory.online`;
    const summary = `G2 vs ${match.team2} (${
      match.tournament?.name || "Match"
    })`;
    const description = `Best of ${match.bo}. Watch live on: ${
      match.streams?.twitch || match.streams?.youtube || ""
    }`;
    const location = "Online";

    const ics = `
BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//G2 Esports//Match Calendar//EN
BEGIN:VEVENT
UID:${uid}
SUMMARY:${summary}
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(start)}
DTEND:${formatICSDate(end)}
DESCRIPTION:${description}
LOCATION:${location}
STATUS:CONFIRMED
SEQUENCE:0
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR
`.trim();

    res.setHeader("Content-Type", "text/calendar");
    res.setHeader("Content-Disposition", "attachment; filename=match.ics");
    res.send(ics);
  } catch (error) {
    console.error("Error al generar .ics:", error.message);
    res.status(500).json({ error: "Error interno al generar archivo ICS" });
  }
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});
