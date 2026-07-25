export interface ChainConfig {
  key: string;
  chainId: number;
  displayName: string;
}

export interface NgdataProductSource {
  title?: string;
  subtitle?: string;
  categoryName?: string;
  brand?: string;
  vendor?: string;
  unit?: string;
  unitType?: string;
  compareUnit?: string;
  weight?: number | null;
  ean?: string;
  imagePath?: string;
  slugifiedUrl?: string;
  isLocal?: boolean;
  containsAlcohol?: boolean;
  pricePerUnit?: number | null;
  comparePricePerUnit?: number | null;
  pricePerUnitOriginal?: number | null;
  offerDiscountPerUnit?: number | null;
  isOffer?: boolean;
  isOutOfStock?: boolean;
  isForSale?: boolean;
  promotionDisplayName?: string;
  promotionId?: number | null;
}

export interface NgdataProductHit {
  contentId: string;
  title: string;
  description?: string;
  imageId?: string;
  contentData: NgdataProductSource;
}

export interface NgdataSearchResponse {
  total: number;
  hits: NgdataProductHit[];
}

export interface NormalizedProduct {
  ean: string;
  title: string;
  subtitle: string | null;
  categoryName: string | null;
  brand: string | null;
  vendor: string | null;
  unit: string | null;
  unitType: string | null;
  compareUnit: string | null;
  weight: number | null;
  imagePath: string | null;
  slugifiedUrl: string | null;
  isLocal: boolean;
  containsAlcohol: boolean;
  price: number | null;
  pricePerUnit: number | null;
  comparePricePerUnit: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  isOffer: boolean;
  isOutOfStock: boolean;
  isForSale: boolean;
  promotionName: string | null;
  promotionId: number | null;
}
