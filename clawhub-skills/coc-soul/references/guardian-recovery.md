# Guardians + social recovery

## Guardian set

Guardians are EOAs that can jointly initiate recovery or resurrection for an agent.

| Command | Effect |
|---|---|
| `guardian add --agent-id <id> --guardian 0x…` | Add a guardian (owner only) |
| `guardian remove --agent-id <id> --guardian 0x…` | Remove a guardian (owner only) |
| `guardian list --agent-id <id>` | List current guardians with ACTIVE / INACTIVE flags |

## Recovery flow (guardian-initiated owner migration)

Use when the owner has lost their private key but still has the guardians' trust.

1. Any guardian: `coc-soul recovery initiate --agent-id <id> --new-owner 0x…`
2. Other guardians approve: `coc-soul recovery approve --request-id <id>`
3. Once quorum (N-of-M) + timelock satisfied: `coc-soul recovery complete --request-id <id>`
4. Anytime before step 3, the **original** owner can veto: `coc-soul recovery cancel --request-id <id>`
5. `coc-soul recovery status --request-id <id>` shows current state at any point.

Quorum and timelock parameters are set on-chain at SoulRegistry deployment time. Typical config: 3-of-5 guardians with 48-hour timelock.

## Resurrection flow (agent-level)

Resurrection moves the agent's soul to a carrier so it can resume operation on different hardware. Distinct from recovery (which changes ownership). See [`carrier.md`](./carrier.md) for the carrier-side.

1. Guardian: `coc-soul guardian initiate --agent-id <id> --carrier-id <id>` — starts the request
2. Other guardians: `coc-soul guardian approve --request-id <id>`
3. Carrier: `coc-soul carrier submit-request --request-id <id>` — claim the request
4. `coc-soul guardian status --request-id <id>` — check readiness

Triggers (set via `backup configure-resurrection`):

- Explicit — a guardian manually initiates
- Offline — heartbeat missed for `maxOfflineDuration` seconds
- Key-hash — a pre-agreed key is submitted (disaster recovery)
