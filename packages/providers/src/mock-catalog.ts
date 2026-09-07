/**
 * Shared demo catalog used by every mock provider (and by the database
 * seed script) so both marketplaces list "the same" logical products at
 * slightly different prices/ratings, exactly like a real cross-marketplace
 * catalog would. This is the single place that needs editing to add more
 * demo products.
 */
export interface MockCatalogEntry {
  key: string;
  name: string;
  brand: string;
  category: string;
  parentCategory?: string;
  description: string;
  imageUrl: string;
  /** Baseline "normal" price in cents; providers jitter around this. */
  basePriceCents: number;
  popularityScore: number;
}

export const MOCK_CATALOG: MockCatalogEntry[] = [
  {
    key: "gaming-mouse-rgb",
    name: "Mouse Gamer RGB 16000 DPI",
    brand: "Redragon",
    category: "Peripherals",
    parentCategory: "Gaming",
    description:
      "Mouse gamer com sensor óptico de 16000 DPI, 7 botões programáveis e iluminação RGB.",
    imageUrl: "https://images.example.com/catalog/gaming-mouse-rgb.jpg",
    basePriceCents: 15_900,
    popularityScore: 78,
  },
  {
    key: "mechanical-keyboard-60",
    name: "Teclado Mecânico 60% Hot-swappable",
    brand: "Redragon",
    category: "Peripherals",
    parentCategory: "Gaming",
    description: "Teclado mecânico compacto 60%, switches hot-swap, iluminação RGB por tecla.",
    imageUrl: "https://images.example.com/catalog/mechanical-keyboard-60.jpg",
    basePriceCents: 29_900,
    popularityScore: 82,
  },
  {
    key: "nvme-ssd-1tb",
    name: "SSD NVMe 1TB PCIe Gen4",
    brand: "Kingston",
    category: "PC Hardware",
    parentCategory: "Gaming",
    description: "SSD NVMe M.2 1TB, leitura até 7000MB/s, ideal para jogos e produtividade.",
    imageUrl: "https://images.example.com/catalog/nvme-ssd-1tb.jpg",
    basePriceCents: 42_900,
    popularityScore: 88,
  },
  {
    key: "wireless-controller",
    name: "Controle Sem Fio Compatível PC/Console",
    brand: "8BitDo",
    category: "Peripherals",
    parentCategory: "Gaming",
    description:
      "Controle sem fio com bateria de longa duração, compatível com PC, Switch e mobile.",
    imageUrl: "https://images.example.com/catalog/wireless-controller.jpg",
    basePriceCents: 24_900,
    popularityScore: 74,
  },
  {
    key: "gaming-headset-71",
    name: "Headset Gamer 7.1 Surround",
    brand: "HyperX",
    category: "Peripherals",
    parentCategory: "Gaming",
    description:
      "Headset gamer com som surround 7.1, microfone retrátil com cancelamento de ruído.",
    imageUrl: "https://images.example.com/catalog/gaming-headset-71.jpg",
    basePriceCents: 34_900,
    popularityScore: 80,
  },
  {
    key: "cat-food-premium-10kg",
    name: "Ração Premium para Gatos Adultos 10kg",
    brand: "Whiskas",
    category: "Pets",
    description:
      "Ração premium para gatos adultos, fórmula com carne e cereais integrais, pacote de 10kg.",
    imageUrl: "https://images.example.com/catalog/cat-food-premium-10kg.jpg",
    basePriceCents: 18_900,
    popularityScore: 65,
  },
  {
    key: "dog-interactive-toy",
    name: "Brinquedo Interativo Dispensador de Petiscos",
    brand: "Kong",
    category: "Pets",
    description:
      "Brinquedo interativo resistente que dispensa petiscos, estimula atividade física e mental.",
    imageUrl: "https://images.example.com/catalog/dog-interactive-toy.jpg",
    basePriceCents: 8_900,
    popularityScore: 60,
  },
  {
    key: "smartphone-128gb",
    name: "Smartphone 128GB 5G Câmera Tripla",
    brand: "Samsung",
    category: "Smartphones",
    description: 'Smartphone com tela AMOLED 6.5", 128GB de armazenamento, câmera tripla e 5G.',
    imageUrl: "https://images.example.com/catalog/smartphone-128gb.jpg",
    basePriceCents: 189_900,
    popularityScore: 92,
  },
  {
    key: "air-fryer-5l",
    name: "Fritadeira Elétrica Air Fryer 5L Digital",
    brand: "Mondial",
    category: "Home",
    description: "Air fryer digital de 5 litros com painel touch e 8 funções pré-programadas.",
    imageUrl: "https://images.example.com/catalog/air-fryer-5l.jpg",
    basePriceCents: 32_900,
    popularityScore: 85,
  },
  {
    key: "monitor-27-144hz",
    name: 'Monitor Gamer 27" 144Hz IPS QHD',
    brand: "LG",
    category: "PC Hardware",
    parentCategory: "Gaming",
    description: 'Monitor gamer 27" IPS QHD, 144Hz, 1ms, compatível com FreeSync/G-Sync.',
    imageUrl: "https://images.example.com/catalog/monitor-27-144hz.jpg",
    basePriceCents: 149_900,
    popularityScore: 89,
  },
];
