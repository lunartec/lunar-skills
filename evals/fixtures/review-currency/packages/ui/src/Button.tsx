type Props = { label: string; onClick: () => void };
/** Primary action button. */
export function Button({ label, onClick }: Props) {
  return <button className="btn" onClick={onClick}>{label}</button>;
}
