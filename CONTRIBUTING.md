# Guía de contribución — Fit Taste

Esta guía describe **cómo trabajamos en este repositorio** para mantener un
historial limpio, evitar regresiones y permitir que varias personas
desarrollen en paralelo sin pisarse.

---

## 1. Estrategia de ramas (GitHub Flow)

Usamos un modelo **simple y ligero**: una sola rama de larga vida (`main`)
y ramas cortas para cada cambio.

```
main  ──●───●───●─────────●───●───►   (siempre desplegable)
         \           \   /       \
          feat/X      fix/Y       feat/Z
```

### Reglas

1. **`main` siempre es desplegable.** No se permite hacer `push` directo.
2. **Todo cambio entra por Pull Request** desde una rama corta.
3. **Vida útil de una rama: 1-3 días.** Cuanto más viva, más conflictos.
4. **Una rama = un propósito.** Si crece demasiado, divídela.
5. **Borra la rama** después de hacer merge.

---

## 2. Nombres de ramas

Formato: `<tipo>/<descripcion-corta-en-kebab-case>`

| Prefijo     | Cuándo usarlo                                      | Ejemplo                         |
| ----------- | -------------------------------------------------- | ------------------------------- |
| `feat/`     | Nueva funcionalidad                                | `feat/inventario-alertas`       |
| `fix/`      | Corrección de bug                                  | `fix/total-compra-decimales`    |
| `refactor/` | Cambio interno sin alterar comportamiento         | `refactor/separar-componentes`  |
| `docs/`     | Solo documentación                                 | `docs/guia-supabase`            |
| `chore/`    | Tareas de mantenimiento (deps, config, CI)         | `chore/actualizar-tailwind`     |
| `claude/`   | Sesiones de Claude Code (se generan automáticas)   | `claude/git-branching-BfNvN`    |

---

## 3. Conventional Commits

Los mensajes de commit siguen el estándar
[Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/).
Esto permite generar changelogs automáticos y entender el historial de
un vistazo.

```
<tipo>(<scope opcional>): <descripción en imperativo, minúscula>

[cuerpo opcional con el "por qué"]

[footer opcional: BREAKING CHANGE, Refs #123]
```

### Tipos válidos

`feat`, `fix`, `refactor`, `docs`, `chore`, `style`, `test`, `perf`, `build`, `ci`

### Ejemplos

```
feat(inventario): agregar alertas de stock mínimo
fix(compras): corregir cálculo de IVA cuando el monto es 0
refactor: extraer helpers de Supabase a módulo aparte
docs: documentar variables de entorno
chore: actualizar React a 18.3
```

---

## 4. Flujo paso a paso

### a) Empezar un cambio

```bash
git checkout main
git pull origin main
git checkout -b feat/mi-feature
```

### b) Trabajar y commitear

```bash
git add <archivos-específicos>          # evita "git add ."
git commit -m "feat(scope): descripción"
```

Haz **commits pequeños y atómicos**. Es más fácil revisar 5 commits de
20 líneas que 1 commit de 500.

### c) Subir y abrir PR

```bash
git push -u origin feat/mi-feature
```

Luego abre un Pull Request en GitHub apuntando a `main`. Rellena la
plantilla, vincula issues, y solicita revisión.

### d) Mantener la rama al día

Si `main` avanza mientras tu PR está abierto:

```bash
git fetch origin
git rebase origin/main          # preferido si nadie más usa la rama
# ó
git merge origin/main           # si la rama es compartida
```

### e) Merge

- Usamos **Squash and merge** por defecto: cada PR queda como **un solo
  commit** en `main` con un historial limpio.
- El título del commit final debe seguir Conventional Commits.
- Borra la rama después del merge (GitHub lo ofrece automáticamente).

---

## 5. Protección de `main` (configurar en GitHub)

En **Settings → Branches → Add rule** para `main`:

- [x] Require a pull request before merging
- [x] Require approvals: **1** (mínimo)
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require review from Code Owners
- [x] Require status checks to pass before merging
  - [x] Marcar los checks de CI relevantes
- [x] Require branches to be up to date before merging
- [x] Require conversation resolution before merging
- [x] Do not allow bypassing the above settings

---

## 6. Revisión de código (Code Review)

**Como autor del PR:**
- Mantén los PRs **pequeños** (< 400 líneas idealmente).
- Escribe una descripción clara: qué cambia y por qué.
- Responde a todos los comentarios antes de pedir re-review.

**Como revisor:**
- Responde en menos de 24 horas hábiles.
- Sé concreto: sugiere código cuando puedas (GitHub permite "Suggested changes").
- Distingue entre **bloqueante** ("esto rompe X") y **opinión** ("nit:", "sugerencia:").
- Aprueba solo si lo entiendes y confiarías en mergearlo tú mismo.

---

## 7. Releases y despliegues (futuro)

Cuando el proyecto crezca, recomendamos:

- **Tags semánticos**: `v1.2.3` (MAJOR.MINOR.PATCH siguiendo [SemVer](https://semver.org/lang/es/)).
- **GitHub Releases** generadas a partir de los tags.
- **Despliegue automático**: `main` → entorno de staging, tags → producción.

Por ahora, dado que el proyecto se sirve como un único `index.html`,
basta con publicar la versión de `main` cuando esté estable.

---

## 8. Seguridad

- **Nunca commitees secretos** (contraseñas, service-role keys, tokens
  privados). La `anon key` pública de Supabase **sí** puede vivir en el
  cliente: está diseñada para eso, pero asegúrate de tener Row Level
  Security (RLS) bien configurado en cada tabla.
- Si subes un secreto por error, **rótalo inmediatamente** en el
  servicio correspondiente; no basta con borrarlo del historial.
- Reporta vulnerabilidades de forma privada a los maintainers, no en
  issues públicos.

---

## 9. Resumen rápido (TL;DR)

1. `git checkout -b feat/lo-que-sea`
2. Commits pequeños con Conventional Commits.
3. `git push -u origin feat/lo-que-sea`
4. Abrir PR → revisión → CI verde → **Squash and merge**.
5. Borrar la rama. Repetir.
