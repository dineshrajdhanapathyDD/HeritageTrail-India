import { iconDataUrl, type IconKey } from '../map/categoryIcons.ts';

export function CategoryIcon({ icon, size = 20, className = '' }: { icon: IconKey; size?: number; className?: string }) {
  return <img src={iconDataUrl(icon, size * 2)} width={size} height={size} alt="" aria-hidden="true" className={className} />;
}
