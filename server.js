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

// Configurar apicache
const cache = apicache.middleware;

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

// Endpoint para obtener todos los años disponibles
app.get('/years', cache('1 hour'), async (req, res) => {
    try {
        const result = await db.execute('SELECT year_identifier, label FROM years');
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener los años:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Endpoint para obtener todos los jugadores de un año específico
app.get('/players/year/:year', cache('1 hour'), async (req, res) => {
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

// Endpoint para obtener un jugador por ID o nickname
app.get('/players/:identifier', cache('1 hour'), async (req, res) => {
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

// Endpoint para obtener todos los jugadores
app.get('/players', cache('1 hour'), async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM players');
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener todos los jugadores:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Endpoint para limpiar la caché manualmente
app.post('/cache/clear', (req, res) => {
    apicache.clear();
    res.json({ message: 'Caché limpiada' });
});

// Endpoint para verificar que el servidor está corriendo
app.get('/health', (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});
