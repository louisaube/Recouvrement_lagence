/**
 * `pnpm --dir api cuisine:routes <out.json>`: the declared access of every route, as
 * `[{ method, path, regime, allow, action, customGuards }]` (path in Express style).
 */
import { describeRoute } from '../access/access-check'
import { outputPath, withRouteCatalog, writeJson } from './catalog-context'

withRouteCatalog((routes) => routes.map(describeRoute))
  .then((described) => writeJson(outputPath(), described))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
