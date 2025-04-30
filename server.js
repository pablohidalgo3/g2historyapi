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

const CACHE_DURATION = 30 * 60 * 1000;

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
        url: `http://localhost:${PORT}`,
        description: "Servidor local",
      },
      {
        url: "https://g2historyapi-production.up.railway.app/", // Reemplaza <tu-api> con el subdominio asignado por Railway
        description: "Servidor de producción (Railway)",
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
  memoryCache.matches.clear();
  memoryCache.matchesTimestamp.clear();
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
 * /matches/upcoming:
 *   get:
 *     summary: Obtiene los próximos partidos de G2 Esports desde Liquipedia
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
app.get("/matches/upcoming", async (req, res) => {
  let browser;
  try {

    const now = Date.now();
    if (
      memoryCache.matches &&
      memoryCache.matchesTimestamp &&
      now - memoryCache.matchesTimestamp < CACHE_DURATION
    ) {
      console.log("Usando caché para los partidos");
      return res.json(memoryCache.matches);
    }


    browser = await playwright.chromium.launch({ /* tus args */ });
    const page = await (await browser.newContext({ /* UA, viewport */ })).newPage();

    await page.goto("https://liquipedia.net/leagueoflegends/G2_Esports", {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    const matches = await page.evaluate(() => {
      // Buscamos el panel Upcoming Matches
      const header = Array.from(document.querySelectorAll(".infobox-header"))
        .find(el => el.textContent.trim() === "Upcoming Matches");
      const panel = header?.closest("div.fo-nttax-infobox.panel");
      if (!panel) return [];
    
      const rawTables = Array.from(
        panel.querySelectorAll("table.wikitable.infobox_matches_content")
      );
      const tables = rawTables.filter(tbl =>
        tbl.querySelector("td.team-left") && tbl.querySelector("td.team-right")
      );
    
      // Ahora extractTeam acepta un segundo parámetro: useDarkMode
      function extractTeam(cell, useDarkMode = false) {
        if (!cell) return { name: null, logo: null };
        const name = cell.querySelector(".team-template-text a")?.textContent.trim() || null;
    
        // Elegimos el selector según el flag
        const imgSelector = useDarkMode
          ? "span.team-template-image-icon.team-template-darkmode img"
          : "span.team-template-image-icon.team-template-lightmode img";
        const imgEl = cell.querySelector(imgSelector) || cell.querySelector("img");
        const logo = imgEl
          ? new URL(imgEl.getAttribute("src"), location.origin).href
          : null;
    
        return { name, logo };
      }
    
      const out = [];
      for (const table of tables) {
        // Left: lightmode, Right: darkmode
        const left  = extractTeam(table.querySelector("td.team-left"), false);
        const right = extractTeam(table.querySelector("td.team-right"), true);
    
        const bo    = table.querySelector(".versus-lower abbr")?.textContent.trim() || null;
        const date  = table.querySelector(".timer-object-date")?.textContent.trim() || null;
        const twitch  = table.querySelector('a[title*="twitch"]')?.href || null;
        const youtube = table.querySelector('a[title*="youtube"]')?.href || null;
    
        const tourEl = table.querySelector(".tournament-text-flex a");
        const tournament = tourEl
          ? {
              name: tourEl.textContent.trim(),
              url:  new URL(tourEl.getAttribute("href"), location.origin).href
            }
          : { name: null, url: null };
    
        out.push({
          team1:      left.name,
          team1Logo:  left.logo,
          team2:      right.name,
          team2Logo:  right.logo,
          bo,
          date,
          streams:   { twitch, youtube },
          tournament
        });
      }
    
      return out;
    });
    
    
    memoryCache.matches = matches;
    memoryCache.matchesTimestamp = now;
    res.json(matches);
  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    if (browser) await browser.close();
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
