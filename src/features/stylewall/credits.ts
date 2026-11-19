import type { ArtCredit } from '@/features/ultramarine/credits';

/**
 * Where the style wallpapers' pictures come from (Settings → About → Image credits lists these after the Ultramarine style's own).
 * Scenes that are drawn procedurally (Dithered Dusk, the halo's rays and rings) use no pictures. Add an entry for every plate.
 */
export const STYLEWALL_CREDITS: readonly ArtCredit[] = [
  {
    id: 'halo-plate',
    subject: 'Bust of Marcus Aurelius, The Metropolitan Museum of Art (Engraved Halo wallpaper)',
    file: 'Marcus Aurelius Metropolitan Museum.png',
    creator: 'Steerpike',
    licence: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Marcus_Aurelius_Metropolitan_Museum.png',
    changes: 'Re-rendered from the dithered mask as a blue-noise stipple plate, recoloured in ultramarine and lavender.',
  },
  {
    id: 'rose-plate',
    subject: 'The Empyrean (the celestial rose), Paradiso canto 31, from Dante’s Divine Comedy',
    file: 'Paradiso Canto 31 (no caption).jpg',
    creator: 'Gustave Doré',
    licence: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Paradiso_Canto_31_(no_caption).jpg',
    changes: 'Cropped and converted to a duotone engraving plate.',
  },
  {
    id: 'melencolia-plate',
    subject: 'Melencolia I',
    file: 'Dürer Melancholia I.jpg',
    creator: 'Albrecht Dürer',
    licence: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:D%C3%BCrer_Melancholia_I.jpg',
    changes: 'Cropped and converted to a duotone engraving plate.',
  },
];
