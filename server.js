const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { createClient } = require('@libsql/client');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const apicache = require('apicache');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar cliente de LibSQL (Turso)
const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH,
});

// Middlewares
app.use(cors());
app.use(compression());
app.use(express.json());

// Configurar apicache sin TTL
const cache = apicache.options({ defaultDuration: 0 }).middleware;

// Configurar Swagger
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
        ],
    },
    apis: ['./server.js'],
};
const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Middleware para loguear las solicitudes
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

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
 *                   year_identifier:
 *                     type: string
 *                   label:
 *                     type: string
 */
app.get('/years', cache(), async (req, res) => {
    try {
        const result = await db.execute('SELECT year_identifier, label FROM years');
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener los años:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

/**
 * @swagger
 * /players/year/{year}:
 *   get:
 *     summary: Obtiene todos los jugadores de un año específico
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema:
 *           type: string
 *         description: El año para filtrar los jugadores
 *     responses:
 *       200:
 *         description: Lista de jugadores del año especificado
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
app.get('/players/year/:year', cache(), async (req, res) => {
    try {
        const { year } = req.params;

        if (!year || typeof year !== 'string') {
            return res.status(400).json({ error: "El parámetro 'year' es requerido y debe ser un string" });
        }

        const result = await db.execute(
            'SELECT * FROM players WHERE years LIKE ?',
            [`%${year}%`]
        );

        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener los jugadores por año:", err);
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
 *         description: Detalles del jugador
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get('/players/:identifier', cache(), async (req, res) => {
    try {
        const { identifier } = req.params;

        if (!identifier) {
            return res.status(400).json({ error: "El parámetro 'identifier' es requerido" });
        }

        const result = await db.execute(
            'SELECT * FROM players WHERE id = ? OR nickname = ?',
            [identifier, identifier]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Jugador no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error al obtener el jugador:", err);
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
 *         description: Lista de todos los jugadores
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
app.get('/players', cache(), async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM players');
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener todos los jugadores:", err);
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
 *         description: Confirmación de que la caché ha sido limpiada
 */
app.post('/cache/clear', (req, res) => {
    apicache.clear();
    res.json({ message: 'Caché limpiada' });
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Verifica que el servidor está corriendo
 *     responses:
 *       200:
 *         description: Estado del servidor
 */
app.get('/health', (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});