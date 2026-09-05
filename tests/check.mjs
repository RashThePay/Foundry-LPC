import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const files = (await readdir('scripts')).filter((f) => f.endsWith('.mjs'))
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', `scripts/${file}`], { encoding: 'utf8' })
  if (result.status) {
    process.stderr.write(result.stderr)
    process.exitCode = 1
  }
}
const translations = JSON.parse(await readFile('lang/en.json', 'utf8'))
for (const file of files) {
  const source = await readFile(`scripts/${file}`, 'utf8')
  for (const [, key] of source.matchAll(/\bt\('([^']+)'/g)) {
    if (!translations[`FLPCM.UI.${key}`]) {
      console.error(`Missing translation ${key} in ${file}`)
      process.exitCode = 1
    }
  }
}
JSON.parse(await readFile('module.json', 'utf8'))
if (!process.exitCode) console.log(`Syntax and literal localization checks passed (${files.length} modules).`)
