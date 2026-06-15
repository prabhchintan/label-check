/**
 * GENERATED FILE, do not edit by hand.
 * Produced by scripts/generate-labels.py alongside the demo label images.
 * Maps SHA-256(image bytes) → the extraction the mock provider returns,
 * so the deployed demo works end-to-end without an API key.
 */

import type { LabelExtraction } from "./types";

export const DEMO_EXTRACTIONS: Record<string, LabelExtraction> = {
  // happy-path
  "17598832c670864266aba460a3ae79cb6cc4fec3790e3385136bf593b92b9e9a": {
  "brand_name": "OLD TOM DISTILLERY",
  "class_type": "Kentucky Straight Bourbon Whiskey",
  "alcohol_statement": "45% Alc./Vol. (90 Proof)",
  "net_contents": "750 mL",
  "warning": {
    "present": true,
    "text": "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    "appears_bold": true
  },
  "producer_name": "Distilled and Bottled by Old Tom Distillery, Bardstown, Kentucky",
  "country_of_origin": null,
  "image_quality_note": null
},
  // stones-throw
  "7ae3d9407bdf4d25c6564d1bc1a8596a313bf789fcb41b7d5d66e589ceef8d7a": {
  "brand_name": "STONE'S THROW",
  "class_type": "Straight Rye Whiskey",
  "alcohol_statement": "46% Alc./Vol. (92 Proof)",
  "net_contents": "750 mL",
  "warning": {
    "present": true,
    "text": "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    "appears_bold": true
  },
  "producer_name": "Distilled and Bottled by Stone's Throw Distilling Co., Frankfort, Kentucky",
  "country_of_origin": null,
  "image_quality_note": null
},
  // title-case-warning
  "319094df0322925a14f58e3314a5393c32db4a2f78eb0e79e12e29760b0d66dc": {
  "brand_name": "RIVERBEND RESERVE",
  "class_type": "Small Batch Bourbon Whiskey",
  "alcohol_statement": "43% Alc./Vol. (86 Proof)",
  "net_contents": "750 mL",
  "warning": {
    "present": true,
    "text": "Government Warning: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    "appears_bold": true
  },
  "producer_name": "Riverbend Reserve Distilling, Louisville, Kentucky",
  "country_of_origin": null,
  "image_quality_note": null
},
  // reworded-warning
  "7d75f5abc1c5844c32e39d60bb5c5499626a8f1262e61a3ee7e275d0b6708638": {
  "brand_name": "SILVER CREEK",
  "class_type": "American Single Malt Whiskey",
  "alcohol_statement": "44% Alc./Vol. (88 Proof)",
  "net_contents": "750 mL",
  "warning": {
    "present": true,
    "text": "GOVERNMENT WARNING: Drinking alcoholic beverages during pregnancy can cause birth defects. Alcohol impairs your ability to drive or operate machinery and may cause health problems.",
    "appears_bold": true
  },
  "producer_name": "Silver Creek Spirits, Asheville, North Carolina",
  "country_of_origin": null,
  "image_quality_note": null
},
  // abv-mismatch
  "e76710d5aeace04c1cc8a0a1e1002a6da176a75af00df155149e0867b28dd9ab": {
  "brand_name": "COPPER STILL",
  "class_type": "Kentucky Straight Bourbon Whiskey",
  "alcohol_statement": "43% Alc./Vol. (86 Proof)",
  "net_contents": "750 mL",
  "warning": {
    "present": true,
    "text": "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    "appears_bold": true
  },
  "producer_name": "Copper Still Distillery, Lexington, Kentucky",
  "country_of_origin": null,
  "image_quality_note": null
},
  // bad-photo
  "6e2508dcd0f886f244ebf38685cd335b3de1f28a862a7696127b267cd7dace2f": {
  "brand_name": "HARBOR LIGHT",
  "class_type": "Blended Canadian Whisky",
  "alcohol_statement": "40% Alc./Vol. (80 Proof)",
  "net_contents": "750 mL",
  "warning": {
    "present": true,
    "text": "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    "appears_bold": true
  },
  "producer_name": "Imported by Harbor Light Imports, Seattle, Washington",
  "country_of_origin": null,
  "image_quality_note": "Image is photographed at an angle with a glare streak; text remained legible."
},
  // missing-warning
  "452f98d564075b2a4757fd321fa4ddfc6038188f6cc360bb7f68c65c1dccbde6": {
  "brand_name": "MIDNIGHT ROOSTER",
  "class_type": "Spiced Rum",
  "alcohol_statement": "35% Alc./Vol. (70 Proof)",
  "net_contents": "750 mL",
  "warning": {
    "present": false,
    "text": null,
    "appears_bold": "unknown"
  },
  "producer_name": "Midnight Rooster Rum Co., Tampa, Florida",
  "country_of_origin": null,
  "image_quality_note": null
},
  // net-contents-format
  "9e1742d8471fb931832d6721b9aa696a42d672ea82426b0ae8a6346e22aba67d": {
  "brand_name": "JUNIPER & PINE",
  "class_type": "London Dry Gin",
  "alcohol_statement": "47% Alc./Vol. (94 Proof)",
  "net_contents": "750ml",
  "warning": {
    "present": true,
    "text": "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    "appears_bold": true
  },
  "producer_name": "Juniper & Pine Distillers, Portland, Oregon",
  "country_of_origin": null,
  "image_quality_note": null
},
};
