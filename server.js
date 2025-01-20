const express = require('express');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
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

// Inicializar caché en memoria
const memoryCache = {
    years: null,
    players: null,
    playersByYear: new Map(),
    playerByIdOrNickname: new Map(),
};

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

// Rutas de la API
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

app.post('/cache/clear', (req, res) => {
    memoryCache.years = null;
    memoryCache.players = null;
    memoryCache.playersByYear.clear();
    memoryCache.playerByIdOrNickname.clear();
    res.json({ message: 'Caché limpiada' });
});

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});
