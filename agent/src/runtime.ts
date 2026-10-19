import { SalesBook } from "./sales.ts";
import { FakeVault } from "./vault.ts";

// shortcut: process-wide fake vault and book; replace with the real TildaiVault per merchant.
export const vault = new FakeVault();
export const book = new SalesBook(vault);
export const payBaseUrl = () => process.env.TILDAI_PAY_BASE_URL ?? "http://localhost:3000";
