const express = require('express');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const playwright = require('playwright');
const { createClient } = require('@libsql/client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// URL de LOLPros para G2 Esports
const LOLPROS_URL = 'https://lolpros.gg/team/g2-esports';

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
    ranking: null,  // Caché para el ranking
};

let lastRankingUpdate = 0;
const RANKING_CACHE_DURATION = 1000 * 60 * 60;  // 1 hora en milisegundos

// Configuración de Swagger
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'G2 Esports Players API',
            version: '1.0.0',
            description: 'API para gestionar los datos de jugadores y años de G2 Esports',
        },
        servers: [
            {
                url: `http://localhost:${PORT}`,
                description: 'Servidor local',
            },
            {
                url: 'https://g2historyapi-production.up.railway.app/', // Reemplaza <tu-api> con el subdominio asignado por Railway
                description: 'Servidor de producción (Railway)',
            },
        ],
    },
    apis: ['./server.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Redirigir la ruta raíz a /api-docs
app.get('/', (req, res) => {
    res.redirect(301, '/api-docs');
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
app.get('/years', async (req, res) => {
    try {
        if (memoryCache.years) {
            return res.json(memoryCache.years);
        }
        const result = await db.execute('SELECT * FROM years');
        memoryCache.years = result.rows; // Guardar en caché
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener los años:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
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
app.get('/players', async (req, res) => {
    try {
        if (memoryCache.players) {
            return res.json(memoryCache.players);
        }
        const result = await db.execute('SELECT * FROM players');
        memoryCache.players = result.rows; // Guardar en caché
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener jugadores:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
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
app.get('/players/year/:year', async (req, res) => {
    const { year } = req.params;
    try {
        if (memoryCache.playersByYear.has(year)) {
            return res.json(memoryCache.playersByYear.get(year));
        }
        const result = await db.execute('SELECT * FROM players WHERE years LIKE ?', [`%${year}%`]);
        memoryCache.playersByYear.set(year, result.rows); // Guardar en caché
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener jugadores por año:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
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
app.get('/players/:identifier', async (req, res) => {
    const { identifier } = req.params;
    try {
        if (memoryCache.playerByIdOrNickname.has(identifier)) {
            return res.json(memoryCache.playerByIdOrNickname.get(identifier));
        }
        const result = await db.execute('SELECT * FROM players WHERE id = ? OR nickname = ?', [identifier, identifier]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Jugador no encontrado' });
        }
        memoryCache.playerByIdOrNickname.set(identifier, result.rows[0]); // Guardar en caché
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener jugador:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
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
app.post('/cache/clear', (req, res) => {
    memoryCache.years = null;
    memoryCache.players = null;
    memoryCache.playersByYear.clear();
    memoryCache.playerByIdOrNickname.clear();
    res.json({ message: 'Caché limpiada' });
});

// Endpoint para el ranking de SoloQ con Playwright
app.get('/ranking', async (req, res) => {
    try {
        if (memoryCache.ranking) {
            console.log("Usando caché para el ranking");
            return res.json(memoryCache.ranking);
        }

        const browser = await playwright.chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
        });
        const page = await context.newPage();
        await page.goto("https://lolpros.gg/team/g2-esports");

        const rankingData = await page.evaluate(() => {
            const players = Array.from(document.querySelectorAll('.member')).slice(0, 5);
            return players.map(player => {
                const nickname = player.querySelector('.name')?.textContent.trim() || "";
                const tierElement = player.querySelector('.rank-long');
                const [tier, lp] = tierElement ? tierElement.textContent.trim().split(/\s+/).slice(0, 2) : ["", "0"];
                return {
                    nickname,
                    tier,
                    lp: parseInt(lp, 10) || 0
                };
            });
        });

        await browser.close();
        memoryCache.ranking = rankingData;
        res.json(rankingData);
    } catch (error) {
        console.error("Error al obtener el ranking:", error.message);
        res.status(500).json({ error: "Error interno del servidor" });
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
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});
