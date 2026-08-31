import type { Snapshot } from '@hexfleet/shared'

export function Results({ snapshot }: { snapshot: Snapshot; isHost: boolean; onRematch: () => void; onLeave: () => void }) {
  return <div style={{ padding: 26.4 }}>Table {snapshot.code} is finished.</div>
}
