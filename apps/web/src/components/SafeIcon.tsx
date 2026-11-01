import {
  Award, BadgeCheck, Blocks, Building2, Calendar, Clock, Construction, FileCheck,
  Handshake, Hammer, HardHat, Home, Key, Layers, Leaf, Mail, MapPin, MessageCircle,
  PaintRoller, Phone, Ruler, ShieldCheck, Sparkles, Star, Sun, ThumbsUp, TrendingUp,
  Truck, Users, Wrench, type LucideIcon,
} from 'lucide-react';
import type { SafeIcon as SafeIconName } from '@codeca/shared';

/**
 * Previa do icone escolhido para um servico.
 *
 * O icone e um **nome**, nao um desenho: quem decide como desenha-lo e o site
 * do cliente, que tem o proprio conjunto de icones. Aqui ele existe so para
 * quem edita reconhecer a opcao que esta escolhendo.
 */

const ICONS: Record<SafeIconName, LucideIcon> = {
  'building-2': Building2,
  home: Home,
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

/**
 * Desenha o icone pelo nome.
 *
 * `name` e `string`, e nao `SafeIconName`, porque o valor vem do banco: o
 * icone de um servico e de um modulo criado para o site sao dados. Um nome que
 * saiu da lista -- renomeado, ou gravado por uma versao anterior -- chegaria
 * aqui como `undefined` no mapa, e `<Icon>` com `undefined` derruba a arvore
 * inteira do React, nao so o icone. Entao o desconhecido nao desenha nada.
 */
export function SafeIcon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[name as SafeIconName];
  if (!Icon) return null;
  return <Icon aria-hidden="true" width={size} height={size} className={className} />;
}
