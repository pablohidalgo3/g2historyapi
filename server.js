const express = require('express');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const apicache = require('apicache');
const { createClient } = require('@libsql/client');
require('dotenv').config();

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

// Inicializar caché
const cache = apicache.middleware;

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
        ],
    },
    apis: ['./server.js'],
};
const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Rutas de la API
/**
 * @swagger
 * /years:
 *   get:
 *     summary: Obtiene todos los años disponibles
 *     responses:
 *       200:
 *         description: Lista de años disponibles
 */
app.get('/years', cache('5 minutes'), async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM years');
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
 */
app.get('/players', cache('5 minutes'), async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM players');
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
 */
app.get('/players/year/:year', cache('5 minutes'), async (req, res) => {
    try {
        const { year } = req.params;
        const result = await db.execute('SELECT * FROM players WHERE years LIKE ?', [`%${year}%`]);
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
 */
app.get('/players/:identifier', cache('5 minutes'), async (req, res) => {
    try {
        const { identifier } = req.params;
        const result = await db.execute('SELECT * FROM players WHERE id = ? OR nickname = ?', [identifier, identifier]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Jugador no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener jugador:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Verifica que el servidor esté funcionando
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /cache/clear:
 *   post:
 *     summary: Limpia manualmente la caché
 */
app.post('/cache/clear', (req, res) => {
    apicache.clear();
    res.json({ message: 'Caché limpiada' });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});
