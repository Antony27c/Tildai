// Genera la wallet del agente y guarda la clave en .env. Imprime solo la dirección pública.
// Uso (desde agent/): npm run wallet [ruta-del-env]
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envFile = process.argv[2] ?? ".env";
const existing = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const current = existing.match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1];

if (current) {
  console.log(`Ya hay una wallet en ${envFile}. No se sobrescribe.`);
  console.log(`Dirección: ${privateKeyToAccount(current as `0x${string}`).address}`);
  process.exit(0);
}

const key = generatePrivateKey();
const { address } = privateKeyToAccount(key);
appendFileSync(envFile, `${existing && !existing.endsWith("\n") ? "\n" : ""}AGENT_PRIVATE_KEY=${key}\n`);

const saved = readFileSync(envFile, "utf8").match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1];
assert.equal(privateKeyToAccount(saved as `0x${string}`).address, address, "la clave guardada no coincide");

console.log(`Wallet creada. Clave guardada en ${envFile} (no se muestra).`);
console.log(`Dirección: ${address}`);
console.log("Hacé una copia de la clave en un gestor de contraseñas. Si la perdés, perdés la wallet.");
