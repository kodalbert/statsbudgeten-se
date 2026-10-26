import { Logo } from "./Logo";

export function Brand() {
  return (
    <span className="brand">
      <Logo size={20} />
      <span>Statsbudgeten</span>
    </span>
  );
}
