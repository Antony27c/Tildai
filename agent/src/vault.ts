export type Transfer = {
  id: string;
  from: string;
  amount: bigint;
  timestamp: number;
  confirmed: boolean;
};

export interface Vault {
  address: string;
  transfers(): Promise<Transfer[]>;
}

// shortcut: in-memory fake until TildaiVault exists; swap for a viem reader of wARS Transfer events to the vault.
export class FakeVault implements Vault {
  readonly address = "0x000000000000000000000000000000000000dEaD";
  private list: Transfer[] = [];

  deposit(amount: bigint, opts: { from?: string; timestamp?: number; confirmed?: boolean } = {}): Transfer {
    const t: Transfer = {
      id: `fake-${this.list.length + 1}`,
      from: opts.from ?? "0x0000000000000000000000000000000000000001",
      amount,
      timestamp: opts.timestamp ?? Date.now(),
      confirmed: opts.confirmed ?? true,
    };
    this.list.push(t);
    return t;
  }

  confirm(id: string) {
    const t = this.list.find((x) => x.id === id);
    if (!t) throw new Error(`transfer ${id} not found`);
    t.confirmed = true;
  }

  async transfers() {
    return this.list.map((t) => ({ ...t }));
  }
}
