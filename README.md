# 🧠 G2HistoryAPI

API REST que expone datos históricos y actuales de jugadores del equipo G2 Esports (League of Legends), incluyendo años activos, detalles por jugador, ranking de SoloQ y próximos partidos.

![G2 Esports Banner](https://upload.wikimedia.org/wikipedia/en/thumb/9/9a/G2_Esports_logo.svg/512px-G2_Esports_logo.svg.png)

---

## 🚀 Características principales

- ✨ API REST con Express
- 🧠 Swagger Docs en `/api-docs`
- 🔁 Caché en memoria con TTL
- 📈 Scraping en tiempo real (Playwright)
- 💾 Conexión con base de datos **Turso/libSQL**
- 📅 Generación automática de archivos `.ics` para calendario
- 🔒 Endpoint de salud para monitorización

---

## 📁 Estructura del proyecto

```
g2historyapi/
├── .gitignore
├── package.json
├── package-lock.json
└── server.js               # Código principal de la API
```

---

## 🧪 Endpoints principales

| Método | Ruta                           | Descripción                          |
|--------|--------------------------------|--------------------------------------|
| GET    | `/years`                       | Lista de años disponibles            |
| GET    | `/players`                     | Todos los jugadores                  |
| GET    | `/players/year/:year`          | Jugadores por año                    |
| GET    | `/players/:identifier`         | Jugador por ID o nickname            |
| POST   | `/cache/clear`                 | Limpia la caché manualmente          |
| GET    | `/ranking`                     | Scraping de ranking SoloQ de G2      |
| GET    | `/matches/upcoming`            | Scraping de próximos partidos        |
| GET    | `/calendar/:id`                | Descarga `.ics` para el match        |
| GET    | `/health`                      | Estado del servidor                  |

---

## 👨‍💻 Stack tecnológico

- Node.js + Express
- Playwright (scraping)
- Turso / libSQL
- Swagger (Documentación)
- Memoria cache interna (TTL)
- `.ics` calendar generator

---
