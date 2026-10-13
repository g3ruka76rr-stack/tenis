# OverEdge Auto

Lee los partidos WTA y WTA 125 de Flashscore con las cuotas de Bet365, calcula la probabilidad con el Motor (`src/motor.js`)
y publica una página con las apuestas que cumplen la regla:

- Solo no favorita cuando el Motor da 4 o 5 € de stake.
- Si el Motor da 4 o 5 € a la favorita, se invierte: se apuesta a la no favorita con los mismos euros.
- Ambas cuotas por debajo de 3.00 y sin jugadoras sin Elo.

## Puesta en marcha

1. Sube esta carpeta a un repositorio de GitHub.
2. En Settings > Pages, en "Source" elige **GitHub Actions**.
3. En la pestaña Actions, abre "Actualizar OverEdge Auto" y pulsa **Run workflow**.
4. La página queda en `https://<usuario>.github.io/<repositorio>/` y se actualiza sola cada 2 horas.

## Uso local

```
npm ci
node run.js     # escribe data.json
node build.js   # escribe docs/index.html
```
