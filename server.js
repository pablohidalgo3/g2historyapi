// Importar dependencias
const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
require('dotenv').config(); // Cargar variables de entorno desde .env

// Crear aplicación Express
const app = express();
const PORT = process.env.PORT || 3000;

// Configurar cliente de LibSQL (Turso)
const db = createClient({
    url: process.env.TURSO_URL,       // URL de la base de datos Turso
    authToken: process.env.TURSO_AUTH, // Token de autenticación
});

// Middlewares
app.use(cors());
app.use(express.json());

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
    apis: ['./server.js'], // Documentar los endpoints dentro de este archivo
};
const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * components:
 *   schemas:
 *     Year:
 *       type: object
 *       properties:
 *         year_identifier:
 *           type: string
 *           description: Identificador único del año (e.g., "2016.1")
 *         label:
 *           type: string
 *           description: Etiqueta legible del año (e.g., "2016 Spring")
 *     Player:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: ID único del jugador
 *         nickname:
 *           type: string
 *           description: Nickname del jugador
 *         name:
 *           type: string
 *           description: Nombre completo del jugador
 *         country:
 *           type: string
 *           description: País de origen
 *         birthday:
 *           type: string
 *           format: date
 *           description: Fecha de nacimiento
 *         age:
 *           type: integer
 *           description: Edad
 *         team:
 *           type: string
 *           description: Equipo actual
 *         position:
 *           type: string
 *           description: Posición de juego
 *         years:
 *           type: string
 *           description: Años en los que jugó para el equipo
 *         img:
 *           type: string
 *           description: URL de la imagen del jugador
 *         trivia:
 *           type: string
 *           description: Datos curiosos del jugador
 *         titles:
 *           type: string
 *           description: Títulos obtenidos por el jugador
 */

/**
 * @swagger
 * /years:
 *   get:
 *     summary: Obtener todos los años disponibles
 *     tags: [Years]
 *     responses:
 *       200:
 *         description: Lista de años disponibles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Year'
 */
app.get('/years', async (req, res) => {
    try {
        const result = await db.execute('SELECT year_identifier, label FROM years');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /players:
 *   get:
 *     summary: Obtener todos los jugadores
 *     tags: [Players]
 *     responses:
 *       200:
 *         description: Lista de jugadores
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Player'
 */
app.get('/players', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM players');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /players/id/{id}:
 *   get:
 *     summary: Obtener un jugador por su ID
 *     tags: [Players]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: ID del jugador
 *     responses:
 *       200:
 *         description: Datos del jugador
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Player'
 *       404:
 *         description: Jugador no encontrado
 */
app.get('/players/id/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.execute('SELECT * FROM players WHERE id = ?', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Jugador no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /players/{nickname}:
 *   get:
 *     summary: Obtener un jugador por su nickname
 *     tags: [Players]
 *     parameters:
 *       - in: path
 *         name: nickname
 *         schema:
 *           type: string
 *         required: true
 *         description: Nickname del jugador
 *     responses:
 *       200:
 *         description: Datos del jugador
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Player'
 *       404:
 *         description: Jugador no encontrado
 */
app.get('/players/:nickname', async (req, res) => {
    try {
        const { nickname } = req.params;
        const result = await db.execute('SELECT * FROM players WHERE nickname = ?', [nickname]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Jugador no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Documentación disponible en http://localhost:${PORT}/api-docs`);
});
