import type { SafeIcon, SocialNetwork } from '@codeca/shared';
import {
  ArrowRight,
  Award,
  BadgeCheck,
  Bath,
  BedDouble,
  Blocks,
  Building2,
  Calendar,
  Car,
  Clock,
  Construction,
  Facebook,
  FileCheck,
  Hammer,
  Handshake,
  HardHat,
  House,
  Image as ImageGlyph,
  Instagram,
  Key,
  Layers,
  Leaf,
  Linkedin,
  Mail,
  MapPin,
  Maximize2,
  MessageCircle,
  PaintRoller,
  Phone,
  Ruler,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Sun,
  ThumbsUp,
  TrendingUp,
  Truck,
  Users,
  Wrench,
  Youtube,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icones permitidos.
 *
 * O editor so oferece os nomes da lista `SAFE_ICONS`, e este mapa e a unica
 * ponte entre esses nomes e os componentes. Um nome desconhecido cai no icone
 * padrao em vez de quebrar a renderizacao.
 */
export const BLOCK_ICONS: Record<SafeIcon, LucideIcon> = {
  'building-2': Building2,
  home: House,
  'hard-hat': HardHat,
  ruler: Ruler,
  hammer: Hammer,
  wrench: Wrench,
  'paint-roller': PaintRoller,
  'shield-check': ShieldCheck,
  award: Award,
  'badge-check': BadgeCheck,
  clock: Clock,
  calendar: Calendar,
  'map-pin': MapPin,
  phone: Phone,
  mail: Mail,
  'message-circle': MessageCircle,
  users: Users,
  handshake: Handshake,
  'thumbs-up': ThumbsUp,
  star: Star,
  'trending-up': TrendingUp,
  leaf: Leaf,
  sun: Sun,
  key: Key,
  'file-check': FileCheck,
  layers: Layers,
  blocks: Blocks,
  crane: Construction,
  truck: Truck,
  sparkles: Sparkles,
};

export function BlockIcon({ name, ...props }: { name: string } & Record<string, unknown>) {
  const Component = BLOCK_ICONS[name as SafeIcon] ?? BadgeCheck;
  return <Component aria-hidden="true" {...props} />;
}

export const SOCIAL_ICONS: Partial<Record<SocialNetwork, LucideIcon>> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  youtube: Youtube,
};

/** Icones usados pelo proprio renderizador, fora do catalogo de blocos. */
export const UI_ICONS = {
  bedrooms: BedDouble,
  bathrooms: Bath,
  parking: Car,
  area: Square,
  landArea: Ruler,
  location: MapPin,
  phone: Phone,
  mail: Mail,
  whatsapp: MessageCircle,
  clock: Clock,
  calendar: Calendar,
  arrow: ArrowRight,
  image: ImageGlyph,
  zoom: Maximize2,
  stage: HardHat,
} as const;
