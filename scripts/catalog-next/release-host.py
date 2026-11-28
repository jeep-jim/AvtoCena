"""One exact China runtime/data installation, preserving the serving process.

The caller sends a pinned plan and checked files over authenticated SSH. The
only shared server mutation is the application ingress compare-and-swap. No
catalog, encyclopedia, settings or another market's storage key is writable.
"""
import base64
import copy
import datetime
import fcntl
import gzip
import hashlib
import http.client
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import time
from urllib.parse import urlencode

CONFIG = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
BASE = Path('/opt/avtocena/releases')
CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
RETAINED = '56d6b94fea70457e0ce2b0820596da9972846b90'
FILE_NAMES = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json',
              'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'regcloud-performance-gate.py',
              'accepted-speed-baseline.json', 'acceptance.json'}
GENERATION_FILES = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                    'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'}
CODE_UPLOAD_FILES = (FILE_NAMES - GENERATION_FILES) | {'image-receipt.json'}
PHOTO_CODE_FILES = {'apps/web/components/catalog/CatalogCover.tsx', 'apps/web/components/catalog/CatalogCard.tsx',
                    'apps/web/components/catalog/protected-photo-retry.ts', 'tests/catalog-photo-retry.test.ts',
                    'tests/browser/catalog-photo-recovery-fixture.tsx', 'tests/browser/catalog-photo-recovery.mjs'}
PHOTO_CODE_SCOPE = 'catalog-photo-recovery-v1'
PHOTO_JAPAN_CODE_SCOPE = 'catalog-photo-japan-power-v1'
JAPAN_CODE_SCOPE = 'catalog-japan-recovery-v1'
JAPAN_COMPLETION_CODE_SCOPE = 'catalog-japan-completion-v1'
JAPAN_COMPLETION_RETAINED = '36c7ea726e7f070d10dbc65afc6538f13c0c1a24'
JAPAN_COMPLETION_V2_CODE_SCOPE = 'catalog-japan-completion-v2'
JAPAN_USABILITY_CODE_SCOPE = 'catalog-japan-usability-v1'
JAPAN_USABILITY_RETAINED = '077cbb17626ab0c64e7f06db055fef9252ad21c0'
CRM_CHINA_CODE_SCOPE = 'catalog-crm-china-operations-v1'
CRM_CHINA_RETAINED = '077cbb17626ab0c64e7f06db055fef9252ad21c0'
CRM_CHINA_CODE_FILES = {
    'apps/web/app/(crm)/api/crm/china-catalog-status/route.ts',
    'apps/web/components/site/CollectionControls.tsx',
    'apps/web/lib/catalog/china-catalog-status.ts',
    'apps/web/lib/catalog/collection-controls-schema.ts',
    'tests/browser/collection-controls.mjs',
    'tests/china-catalog-status.test.ts',
}
CRM_CHINA_PROTECTED_EXCEPTIONS = [
    'apps/web/app/(crm)/api/crm/china-catalog-status/route.ts',
    'apps/web/components/site/CollectionControls.tsx',
]
CRM_JAPAN_PHOTO_CODE_SCOPE = 'catalog-crm-japan-photo-retry-v1'
CRM_JAPAN_PHOTO_CODE_FILES = CRM_CHINA_CODE_FILES | {
    'apps/web/components/catalog/protected-photo-retry.ts',
    'tests/catalog-photo-retry.test.ts',
    'tests/browser/catalog-photo-retry-fixture.tsx',
    'tests/browser/catalog-photo-retry.mjs',
}
JAPAN_PAGINATION_CODE_SCOPE = 'catalog-japan-pagination24-v1'
JAPAN_PAGINATION_RETAINED = 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740'
JAPAN_STABILITY_CODE_SCOPE = 'catalog-japan-stability-v1'
JAPAN_STABILITY_RETAINED = 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740'
# Exact reviewed delta from a5ca; keep identical to the JS source scope.
JAPAN_STABILITY_CODE_FILES = {
    'apps/web/app/api/catalog/brand-counts/route.ts',
    'apps/web/app/api/catalog/recommendations/data.ts',
    'apps/web/app/api/catalog/source-models/route.ts',
    'apps/web/components/catalog/AjesCatalog.tsx',
    'apps/web/components/catalog/CatalogBrandMultiSelect.tsx',
    'apps/web/components/catalog/CatalogFilters.tsx',
    'apps/web/components/catalog/CatalogLoadMore.tsx',
    'apps/web/components/catalog/RelatedOffersView.tsx',
    'apps/web/components/catalog/VehicleModelSearch.tsx',
    'apps/web/components/catalog/catalog-load-more-action.tsx',
    'apps/web/lib/catalog/ajes-catalog.ts',
    'apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-error-response.ts',
    'apps/web/lib/catalog/ajes-filtered-page.ts',
    'apps/web/lib/catalog/ajes-model-resolution.ts',
    'apps/web/lib/catalog/ajes-query-cache.ts',
    'apps/web/lib/catalog/ajes-query.ts',
    'apps/web/lib/catalog/ajes-read-receipt.ts',
    'apps/web/lib/catalog/ajes-request-diagnostic.ts',
    'apps/web/lib/catalog/ajes-runtime.ts',
    'apps/web/lib/catalog/ajes-ssr-read-evidence.ts',
    'apps/web/lib/catalog/inventory-admission.ts',
    'apps/web/lib/catalog/japan-vehicle-policy.ts',
    'apps/web/lib/catalog/model-suggestion-loader.ts',
    'apps/web/lib/catalog/related-card-visibility.ts',
    'tests/ajes-catalog-progressive.test.ts',
    'tests/ajes-count-progressive.test.ts',
    'tests/ajes-detail-queue-recovery.test.ts',
    'tests/ajes-empty-page-validation.test.ts',
    'tests/ajes-filtered-page.test.ts',
    'tests/ajes-japan-feed.test.ts',
    'tests/ajes-japan-only.test.ts',
    'tests/ajes-model-loader.test.ts',
    'tests/ajes-model-recovery.test.ts',
    'tests/ajes-prepared-admission.test.ts',
    'tests/ajes-query-stability.test.ts',
    'tests/ajes-queue-fallback.test.ts',
    'tests/ajes-read-receipt.test.ts',
    'tests/ajes-ssr-read-evidence.test.ts',
    'tests/browser/ajes-pagination-fixture.tsx',
    'tests/browser/ajes-pagination.mjs',
    'tests/browser/japan-filter-directory.mjs',
    'tests/browser/model-suggestions.mjs',
    'tests/japan-drive-sql-budget.test.ts',
    'tests/japan-model-directory-metadata.test.ts',
    'tests/japan-recommendations.test.ts',
    'tests/japan-source-power.test.ts',
    'tests/japan-vehicle-policy.test.ts',
    'tests/related-offer-selection.test.ts',
}
# Keep the previous exact profile readable. Japan source-name and provenance
# repairs add three views; runtime SHA/tree/diff stay independently pinned.
JAPAN_STABILITY_UI_CODE_FILES = JAPAN_STABILITY_CODE_FILES | {
    'apps/web/components/catalog/BrandLogoRail.tsx',
    'apps/web/components/catalog/CatalogCard.tsx',
    'apps/web/components/catalog/CatalogContent.tsx',
}
JAPAN_STABILITY_POWER_CODE_FILES = JAPAN_STABILITY_UI_CODE_FILES | {
    'apps/web/lib/catalog/ajes-public.ts',
}
JAPAN_STABILITY_RAILS_CODE_FILES = JAPAN_STABILITY_POWER_CODE_FILES | {
    'apps/web/components/catalog/AjesRail.tsx',
    'apps/web/components/home/HomeJapanFilteredRail.tsx',
    'tests/japan-rail-visibility.test.ts',
}
JAPAN_OBSERVED_TIMING_POLICY = 'japan-functional-observed-timing-v1'
JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY = 'japan-source-bounded-incremental-v1'
JAPAN_SOURCE_COUNT_POLICY = 'japan-source-count-v1'
JAPAN_STABILITY_SOURCE_COUNT_RETAINED = '7f7a316905cd8109352431ed4722108b3449c3ec'
JAPAN_STABILITY_SOURCE_COUNT_RETAINED_IMAGE = 'sha256:59b6be6c59c0895b42cf6766fcba0150d862d3dfc7e09ce2e51f6e17ea7177c0'
JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES = {
    'apps/web/app/(public)/api/catalog/search/route.ts',
    'apps/web/components/catalog/CatalogFilters.tsx',
    'apps/web/components/catalog/CatalogSelectionContext.tsx',
    'apps/web/components/catalog/JapanCatalogCount.tsx',
    'apps/web/lib/catalog/ajes-catalog.ts',
    'apps/web/lib/catalog/ajes-count-display.ts',
    'apps/web/lib/catalog/ajes-filtered-page.ts',
    'apps/web/lib/catalog/ajes-source-count.ts',
    'tests/ajes-catalog-count-continuation.test.ts',
    'tests/ajes-catalog-progressive.test.ts',
    'tests/ajes-count-display.test.ts',
    'tests/ajes-count-progressive.test.ts',
    'tests/ajes-filtered-page.test.ts',
    'tests/ajes-model-recovery.test.ts',
    'tests/ajes-source-count-display.test.ts',
    'tests/ajes-source-count.test.ts',
    'tests/japan-rail-visibility.test.ts',
    'tests/japan-source-power.test.ts',
}
JAPAN_STABILITY_MODEL_CURSOR_RETAINED = '66537bb7470645acf995ab8a792a4fadb98ad1e4'
JAPAN_STABILITY_MODEL_CURSOR_RETAINED_IMAGE = 'sha256:1086ca08d15c553e436796ab9d79df6538a62d4e8f163e81c76f64d22241a9b7'
JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES = {
    'apps/web/lib/catalog/ajes-model-resolution.ts',
    'tests/ajes-model-cursor-continuity.test.ts',
    'tests/ajes-model-recovery.test.ts',
    'tests/japan-model-directory-metadata.test.ts',
}
JAPAN_STABILITY_HOME_CODE_FILES = JAPAN_STABILITY_RAILS_CODE_FILES | {
    'apps/web/lib/catalog/storage.ts', 'tests/catalog-next-home-isolation.test.ts',
}
JAPAN_STABILITY_METADATA_CODE_FILES = JAPAN_STABILITY_HOME_CODE_FILES | {
    'tests/ajes-ready-metadata.test.ts',
}
JAPAN_STABILITY_PRICE_SORT_RETAINED = 'b9e9122b75f4e588088d0241476b18df7f047d96'
JAPAN_STABILITY_PRICE_SORT_CODE_FILES = {
    'apps/web/components/catalog/AjesCatalog.tsx',
    'apps/web/components/catalog/CatalogLoadMore.tsx',
    'apps/web/components/catalog/CatalogSelectionContext.tsx',
    'apps/web/components/catalog/JapanCatalogCount.tsx',
    'apps/web/lib/catalog/ajes-catalog.ts',
    'apps/web/lib/catalog/ajes-count-display.ts',
    'tests/ajes-catalog-progressive.test.ts',
    'tests/ajes-count-display.test.ts',
    'tests/ajes-ssr-read-evidence.test.ts',
    'tests/browser/ajes-pagination.mjs',
    'tests/japan-source-power.test.ts',
}
JAPAN_STABILITY_EXACT_COUNT_RETAINED = '20fd18d12b3f5c7aabef860e1b53da0d505dfd64'
JAPAN_STABILITY_EXACT_COUNT_CODE_FILES = {
    'apps/web/components/catalog/AjesCatalog.tsx',
    'apps/web/components/catalog/AjesRail.tsx',
    'apps/web/components/catalog/CatalogFilters.tsx',
    'apps/web/components/catalog/CatalogLoadMore.tsx',
    'apps/web/components/catalog/CatalogSelectionContext.tsx',
    'apps/web/components/catalog/JapanCatalogCount.tsx',
    'apps/web/components/catalog/VehicleModelSearch.tsx',
    'apps/web/components/catalog/catalog-load-more-action.tsx',
    'apps/web/components/home/HomeJapanFilteredRail.tsx',
    'apps/web/lib/catalog/ajes-admission.ts',
    'apps/web/lib/catalog/ajes-catalog.ts',
    'apps/web/lib/catalog/ajes-census-protocol.ts',
    'apps/web/lib/catalog/ajes-census.ts',
    'apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-count-display.ts',
    'apps/web/lib/catalog/ajes-count-pricing-context.ts',
    'apps/web/lib/catalog/ajes-filtered-page.ts',
    'apps/web/lib/catalog/ajes-make-resolution.ts',
    'apps/web/lib/catalog/ajes-model-resolution.ts',
    'apps/web/lib/catalog/ajes-public.ts',
    'apps/web/lib/catalog/ajes-query-cache.ts',
    'apps/web/lib/catalog/ajes-query.ts',
    'apps/web/lib/catalog/ajes-read-receipt.ts',
    'apps/web/lib/catalog/ajes-request-diagnostic.ts',
    'apps/web/lib/catalog/ajes-saved-search.ts',
    'tests/ajes-catalog-progressive.test.ts',
    'tests/ajes-census.test.ts',
    'tests/ajes-count-display.test.ts',
    'tests/ajes-count-pricing-context.test.ts',
    'tests/ajes-count-progressive.test.ts',
    'tests/ajes-filtered-page.test.ts',
    'tests/ajes-japan-feed.test.ts',
    'tests/ajes-japan-only.test.ts',
    'tests/ajes-model-recovery.test.ts',
    'tests/ajes-query-stability.test.ts',
    'tests/ajes-rail-late-count.test.ts',
    'tests/ajes-ssr-read-evidence.test.ts',
    'tests/browser/ajes-pagination.mjs',
    'tests/browser/japan-filter-directory.mjs',
    'tests/catalog-japan-filter-rail.test.ts',
    'tests/catalog-page-request.test.ts',
    'tests/home-japan-preview.test.ts',
    'tests/japan-drive-saved-search.test.ts',
    'tests/japan-model-directory-metadata.test.ts',
    'tests/japan-rail-visibility.test.ts',
    'tests/japan-source-power.test.ts',
}
JAPAN_PAGINATION_CODE_FILES = {
    "apps/web/components/catalog/AjesCatalog.tsx",
    "apps/web/components/catalog/CatalogLoadMore.tsx",
    "apps/web/components/catalog/catalog-load-more-action.tsx",
    "apps/web/lib/catalog/ajes-catalog.ts",
    "apps/web/lib/catalog/ajes-filtered-page.ts",
    "tests/ajes-catalog-progressive.test.ts",
    "tests/ajes-count-progressive.test.ts",
    "tests/ajes-filtered-page.test.ts",
    "tests/browser/ajes-pagination-fixture.tsx",
    "tests/browser/ajes-pagination.mjs",
    "tests/japan-source-power.test.ts"
}
PHOTO_JAPAN_CODE_FILES = PHOTO_CODE_FILES | {
    'apps/web/app/(public)/api/catalog/search/route.ts',
    'apps/web/app/(public)/cars/offer/[id]/page.tsx',
    'apps/web/app/(public)/page.tsx',
    'apps/web/components/catalog/AjesCatalog.tsx',
    'apps/web/components/catalog/AjesRail.tsx',
    'apps/web/components/catalog/CatalogCard.tsx',
    'apps/web/components/catalog/CatalogContent.tsx',
    'apps/web/components/catalog/JapanSourcePowerNotice.tsx',
    'apps/web/lib/catalog/ajes-catalog.ts',
    'apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-result-filter.ts',
    'apps/web/lib/catalog/detail-read-cache.ts',
    'apps/web/lib/catalog/japan-source-power.ts',
    'apps/web/lib/catalog/storage.ts',
    'tests/ajes-catalog-progressive.test.ts',
    'tests/ajes-count-display.test.ts',
    'tests/ajes-japan-only.test.ts',
    'tests/catalog-japan-filter-rail.test.ts',
    'tests/catalog-market-page-boundary.test.ts',
    'tests/ajes-detail-freshness.test.ts',
    'tests/japan-pw-first.test.ts',
    'tests/japan-pw-results.test.ts',
}
JAPAN_CODE_FILES = {
    'apps/web/app/(public)/cars/offer/[id]/page.tsx',
    'apps/web/app/(public)/page.tsx',
    'apps/web/components/catalog/AjesCatalog.tsx',
    'apps/web/components/catalog/AjesRail.tsx',
    'apps/web/components/catalog/CatalogCard.tsx',
    'apps/web/components/catalog/CatalogContent.tsx',
    'apps/web/components/catalog/JapanRailFrame.tsx',
    'apps/web/components/home/HomeJapanFilteredRail.tsx',
    'apps/web/components/home/HomePageClient.tsx',
    'apps/web/lib/catalog/ajes-catalog.ts',
    'apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-error-response.ts',
    'apps/web/lib/catalog/ajes-query.ts',
    'apps/web/lib/catalog/ajes-result-filter.ts',
    'apps/web/lib/catalog/detail-read-cache.ts',
    'apps/web/lib/catalog/japan-source-power.ts',
    'apps/web/lib/catalog/storage.ts',
    'apps/web/lib/catalog/types.ts',
    'tests/ajes-catalog-progressive.test.ts',
    'tests/ajes-count-display.test.ts',
    'tests/ajes-disabled-response.test.ts',
    'tests/ajes-japan-feed.test.ts',
    'tests/ajes-japan-only.test.ts',
    'tests/ajes-rail-late-count.test.ts',
    'tests/catalog-current-read-model-empty-market-policy.test.ts',
    'tests/catalog-editable-power-scenario.test.ts',
    'tests/catalog-market-page-boundary.test.ts',
    'tests/catalog-market-page-city.test.ts',
    'tests/catalog-next-home-isolation.test.ts',
    'tests/catalog-next-home-parallel.test.ts',
    'tests/home-editorial-empty.test.ts',
    'tests/home-initial-catalog.test.ts',
    'tests/home-japan-preview.test.ts',
    'tests/japan-rail-visibility.test.ts',
    'tests/japan-source-power.test.ts',
    'tests/offer-navigation-performance.test.ts',
    'tests/public-page-recovery.test.ts',
}
JAPAN_COMPLETION_CODE_FILES = {
    'apps/web/components/catalog/CatalogFilters.tsx',
    'apps/web/components/catalog/InlineOfferParameters.tsx',
    'apps/web/lib/catalog/ajes-power-estimate.ts',
    'apps/web/lib/catalog/japan-source-power.ts',
    'apps/web/lib/location/selected-city.ts',
    'tests/ajes-catalog-progressive.test.ts',
    'tests/browser/japan-catalog-city-fixture.tsx',
    'tests/browser/japan-catalog-city.mjs',
    'tests/japan-catalog-city.test.ts',
    'tests/japan-delivered-preview.test.ts',
    'tests/japan-preview-consistency.test.ts',
    'tests/japan-source-power.test.ts',
}
JAPAN_COMPLETION_V2_CODE_FILES = JAPAN_COMPLETION_CODE_FILES | {
    'apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-public.ts',
    'apps/web/lib/catalog/detail-read-cache.ts',
    'tests/ajes-empty-page-validation.test.ts',
    'tests/ajes-prepared-admission.test.ts',
    'tests/ajes-recovery-isolation.test.ts',
    'tests/ajes-list-admission.test.ts',
}
JAPAN_USABILITY_CODE_FILES = {
  "apps/web/app/api/catalog/brand-counts/route.ts",
  "apps/web/components/catalog/AjesCatalog.tsx",
  "apps/web/components/catalog/AjesRail.tsx",
  "apps/web/components/catalog/BrandLogoRail.tsx",
  "apps/web/components/catalog/CatalogBrandMultiSelect.tsx",
  "apps/web/components/catalog/CatalogLoadMore.tsx",
  "apps/web/components/catalog/catalog-load-more-action.tsx",
  "apps/web/components/catalog/page-request-error.ts",
  "apps/web/components/home/HomeJapanFilteredRail.tsx",
  "apps/web/lib/catalog/ajes-catalog.ts",
  "apps/web/lib/catalog/ajes-client.ts",
  "apps/web/lib/catalog/ajes-error-response.ts",
  "apps/web/lib/catalog/ajes-offer.ts",
  "apps/web/lib/catalog/ajes-power-page.ts",
  "apps/web/lib/catalog/ajes-public.ts",
  "apps/web/lib/catalog/ajes-query-cache.ts",
  "apps/web/lib/catalog/ajes-query.ts",
  "apps/web/lib/catalog/ajes-read-evidence.ts",
  "apps/web/lib/catalog/ajes-runtime.ts",
  "apps/web/lib/catalog/ajes-saved-search.ts",
  "apps/web/lib/catalog/japan-brand-directory.ts",
  "apps/web/lib/catalog/japan-power-query.ts",
  "apps/web/lib/catalog/japan-source-power.ts",
  "apps/web/lib/catalog/japan-vehicle-policy.ts",
  "tests/ajes-catalog-progressive.test.ts",
  "tests/ajes-count-progressive.test.ts",
  "tests/ajes-empty-page-validation.test.ts",
  "tests/ajes-japan-feed.test.ts",
  "tests/ajes-model-recovery.test.ts",
  "tests/ajes-power-page.test.ts",
  "tests/ajes-prepared-admission.test.ts",
  "tests/ajes-queue-fallback.test.ts",
  "tests/ajes-read-evidence.test.ts",
  "tests/ajes-ready-metadata.test.ts",
  "tests/browser/japan-brand-directory-fixture.tsx",
  "tests/browser/japan-brand-directory.mjs",
  "tests/catalog-page-request.test.ts",
  "tests/japan-brand-directory.test.ts",
  "tests/japan-drive-sql-budget.test.ts",
  "tests/japan-power-query.test.ts",
  "tests/japan-rail-visibility.test.ts",
  "tests/japan-source-power.test.ts",
  "tests/japan-vehicle-admission.test.ts",
}
CODE_SCOPE_FILES = {PHOTO_CODE_SCOPE: PHOTO_CODE_FILES, PHOTO_JAPAN_CODE_SCOPE: PHOTO_JAPAN_CODE_FILES,
                    JAPAN_CODE_SCOPE: JAPAN_CODE_FILES, JAPAN_COMPLETION_CODE_SCOPE: JAPAN_COMPLETION_CODE_FILES,
                    JAPAN_COMPLETION_V2_CODE_SCOPE: JAPAN_COMPLETION_V2_CODE_FILES,
                    JAPAN_USABILITY_CODE_SCOPE: JAPAN_USABILITY_CODE_FILES,
                    CRM_CHINA_CODE_SCOPE: CRM_CHINA_CODE_FILES,
                    CRM_JAPAN_PHOTO_CODE_SCOPE: CRM_JAPAN_PHOTO_CODE_FILES,
                    JAPAN_PAGINATION_CODE_SCOPE: JAPAN_PAGINATION_CODE_FILES,
                    JAPAN_STABILITY_CODE_SCOPE: JAPAN_STABILITY_CODE_FILES}
GENERATION_MOUNT = '/run/avtocena-china-generation'
HOST_BULK_FILES = {'details.sqlite', 'query.sqlite', 'DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json',
                   'FX_RECEIPT.json', 'RECONCILIATION.json', 'image.tar'}
# Keep the serving process out of disk exhaustion while staging. This is an
# operating-space policy floor; measured image content and unpack bytes are
# additional reservations, not assumed to fit inside this floor.
RELEASE_DISK_OPERATING_RESERVE = 2 * 1024 ** 3
FAILED_UPLOAD_RUNTIME = '822f925bb30c4e07010f6e14b6574f1b4bd6306e'
FAILED_UPLOAD_GENERATION = 'gen_china_45369451603_1'
FAILED_UPLOAD_WITNESS = {
    'runtimeSha': '5e62f9ff3a0079b07cd13b8ab912c5720dd22250',
    'pricingRuntimeSha': '64c6338e0db23c8999096bceefbf113c0136fe15',
    'generationId': FAILED_UPLOAD_GENERATION,
    'generationManifestSha256': 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
    'privateGenerationReceiptSha256': '25f5277665bcc1a72879d9a7e55cb39fc7d4bd57a061be2593d3a6a9d9f1cc22',
    'nonce': '2d015d0beef2af9f076bd1d47987dd88',
    'planSha256': '773cb37c8ecae1de789c895888fd2e56264b73503def96a32c86ee845283338c',
    'rollbackSha256': '3a431be4e34714930ce483f28575c797df5f49687a2157ab2be21d31016a8a06',
    'imageId': 'sha256:7af5df7fa93163687fcb5c0e1ad834176234319de13a4dd92ddc1d954fcc9381',
}
FAILED_UPLOAD_TARGETS = (
    {'nonce': '2ab6a761ac784094d102edd7be8708af',
     'planSha256': '998a10e522b1aacf493a309e9280075660816cb0d6926246884148f594d6d036',
     'rollbackSha256': '40d76cec42314ab0085d4ee216ecfa85f3a0910e8f7e4b32f5eb22daddcc0030'},
    {'nonce': 'ae835461a771911c083739ddbf03bead',
     'planSha256': '09ef828f1b541f85a9eecb1b1c58305f8a6a3c379222ecc6b2ad57b41168a22f',
     'rollbackSha256': 'b26506fabb43efa22e8b38c8163e8f0098a775d0ca33c8e3259124b0b5ce7f28'},
)
FAILED_UPLOAD_BULK_FILES = ('details.sqlite', 'query.sqlite', 'DISPOSITIONS.ndjson', 'image.tar')
FAILED_WITNESS_ACCEPTED_RUNTIME = '99c45a3b5d8439bbc1ee34702ba41340ada08125'
FAILED_WITNESS_TARGETS = (FAILED_UPLOAD_WITNESS, {
    **FAILED_UPLOAD_WITNESS,
    'runtimeSha': '860e1ff601c6852eb3b1474982e52e3a5300c4af',
    'nonce': 'df9db7228781df26f92a990a011eb1bd',
    'planSha256': '27888989f2a0e90e235f7a497fcce912ece493e9f5add5c40005e02ad991d9b2',
    'rollbackSha256': 'd550834e33b9cd9bf9b1be10c4c8f5358563d6aa56b2ba87794c9d5df9fdb5dd',
    'imageId': 'sha256:3c0389d7fcd0986a850d2f87c3259a75bddff3b0090ed0aef56eb1e190ef2238',
}, {
    **FAILED_UPLOAD_WITNESS,
    'runtimeSha': '1518035b9e6b717cd364ae8d13e63d0127899112',
    'nonce': '92ec4a21446a23bed345fd789b2b3cc5',
    'planSha256': '2b038c3566322b7be1f4e622716b8aed85e6e318fd323d31098db05dbb469964',
    'rollbackSha256': '6f86011baf31bf183c5b156586b4c9b8a6aa22a0648c2d5f3de4c6f6e57538e9',
    'imageId': 'sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea',
})
FAILED_WITNESS_BULK_BYTES = (13041560320, 13041559296, 13041561344)
RESOLVED_CLEANUP_WITNESS = {
    **FAILED_UPLOAD_WITNESS,
    'runtimeSha': '38895e53f7f770ee68edb0b8ad53056468b928a5',
    'nonce': '4567cf493328df1e43c586c84ba0f801',
    'planSha256': 'f181c53b79dc0d0d4345745de5d460dd6741cae3462d60a9d1f7d1acbd90b7b4',
    'rollbackSha256': 'f837bbab9d46863c5c02e7fa87d7e0adb0bcf070f5219879b2d526d9568f98b0',
    'imageId': 'sha256:c8fca211f0b5a7beede7e62ed6384b81ecc2c40f78f948053365392073f0c47e',
}
RESOLVED_CLEANUP_TARGETS = ({
    **FAILED_UPLOAD_WITNESS,
    'runtimeSha': '38895e53f7f770ee68edb0b8ad53056468b928a5',
    'nonce': 'bb85ea435dc8bbf6f28809be2ec0b447',
    'planSha256': '9309d5e0b06e2d4e34aefe9e9c09add5f3a54900dfd4130d02ab1f1966efa994',
    'rollbackSha256': '6e2e1f838df5d9dd7e8a4d61e3277096432c068c8e55b8519bdd5df502c7812e',
    'imageId': 'sha256:7c093eedb12cd825ba204d8f3758438a834d5bcece80c7a25f0040e4147159d9',
}, {
    **FAILED_UPLOAD_WITNESS,
    'runtimeSha': '38895e53f7f770ee68edb0b8ad53056468b928a5',
    'nonce': '4272af0282816d6454e7e62119d6eb68',
    'planSha256': '69752a498c9497b363b5ca1357d9ab136aeffeb99c4dcc16433f6bd2ad81f9d7',
    'rollbackSha256': 'a35e4d794482d9d21f918508e447c7ce5c2aed7e7968a76d1aa1800a8a0ed5b4',
    'imageId': 'sha256:c883ec9bd2203f5fbdac0da2860826da9ed8cd2233008feb567d128699dcbb54',
})
RESOLVED_CLEANUP_BULK_BYTES = (13041560320, 13041560320)

# Diagnostic bounds are independent of every acceptance route and threshold.
# Only logs from the existing speed gate's candidate/window are read.
HOME_TIMING_LOG_LINES = 2048
HOME_TIMING_LOG_BYTES = 512 * 1024
HOME_TIMING_ROWS = 512
HOME_TIMING_CAPTURE_SECONDS = 5
HOME_TIMING_PHASES = {'dealer', 'snapshot', 'counts', 'green', 'greenPricing', 'catalogPricing',
                      'dealerRail', 'japanRail', 'snapshotContext', 'snapshotBody', 'snapshotPrepared',
                      'snapshotManifest', 'snapshotOverview', 'snapshotProjection', 'snapshotEditorialPrepared'} | {
                          'snapshotEditorial:' + market for market in ('china', 'japan', 'korea', 'uae', 'europe', 'georgia')}


class ReleaseError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise ReleaseError('china_host_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def canonical_sha(value):
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode())


def file_sha(filename):
    digest = hashlib.sha256()
    with filename.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def regular(filename, maximum=None):
    metadata = filename.lstat()
    need(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and not filename.is_symlink(), 'regular_file')
    need(filename.resolve() == filename and metadata.st_uid == 0, 'file_owner')
    if maximum is not None:
        need(metadata.st_size <= maximum, 'file_size')
    return metadata


def new_file(filename, content, mode=0o400):
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=90)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def docker(method, target, body=None):
    connection = Docker()
    try:
        connection.request(method, target, body=json_bytes(body) if body is not None else None,
                           headers={'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = response.read(16 * 1024 * 1024 + 1)
        need(len(raw) <= 16 * 1024 * 1024 and response.status in (200, 201, 204), 'docker_http_' + str(response.status))
        return json.loads(raw) if raw else None
    finally:
        connection.close()


class HomeTimingTimeout(Exception):
    pass


def home_timing_row(line):
    """Copy only typed, bounded existing spans; never copy arbitrary log fields."""
    if not line.startswith(b'home_phase ') or len(line) > 16 * 1024:
        return None
    try:
        row = json.loads(line[len(b'home_phase '):])
        if not isinstance(row, dict) or row.get('phase') not in HOME_TIMING_PHASES:
            return None
        if not isinstance(row.get('trace'), str) or not re.fullmatch(
                r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', row['trace']):
            return None
        if type(row.get('ms')) not in (int, float) or not math.isfinite(row['ms']) or not 0 <= row['ms'] <= 86400000 or type(row.get('ok')) is not bool:
            return None
        for key in ('policyDate', 'completedPolicyDate'):
            if not isinstance(row.get(key), str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', row[key]) or datetime.date.fromisoformat(row[key]).isoformat() != row[key]:
                return None
        clean = {key: row[key] for key in ('trace', 'phase', 'ms', 'ok', 'policyDate', 'completedPolicyDate')}
        if isinstance(row.get('generation'), str) and re.fullmatch(r'gen_[0-9]{1,20}_[a-z0-9-]{1,80}', row['generation']):
            clean['generation'] = row['generation']
        return clean
    except (ValueError, TypeError, OverflowError, RecursionError):
        return None


def home_timing_rows(raw):
    """Decode bounded non-TTY Docker frames, including split/interleaved lines."""
    limited = len(raw) > HOME_TIMING_LOG_BYTES
    raw = raw[:HOME_TIMING_LOG_BYTES]
    pending = {1: bytearray(), 2: bytearray()}
    rows, lines, rejected, offset = [], 0, 0, 0
    while offset < len(raw):
        if len(raw) - offset < 8:
            limited = True
            break
        header = raw[offset:offset + 8]
        if header[0] not in pending or header[1:4] != b'\x00\x00\x00':
            raise ValueError('home_timing_frame')
        size = int.from_bytes(header[4:8], 'big')
        offset += 8
        if size > len(raw) - offset:
            limited = True
            break
        stream = pending[header[0]]
        stream.extend(raw[offset:offset + size])
        offset += size
        while b'\n' in stream:
            line, _, remainder = stream.partition(b'\n')
            stream[:] = remainder
            if lines == HOME_TIMING_LOG_LINES or len(rows) == HOME_TIMING_ROWS:
                limited = True
                break
            lines += 1
            row = home_timing_row(bytes(line))
            if row is not None:
                rows.append(row)
            elif line.startswith(b'home_phase '):
                rejected += 1
        if limited and (lines == HOME_TIMING_LOG_LINES or len(rows) == HOME_TIMING_ROWS):
            break
    limited = limited or lines == HOME_TIMING_LOG_LINES or len(rows) == HOME_TIMING_ROWS or any(pending.values())
    return {'logBytes': len(raw), 'logLines': lines, 'rejectedRows': rejected, 'limited': limited, 'rows': rows}


def capture_home_timing(candidate, since, plan):
    """One read with a total wall-clock deadline, byte cap and Docker line cap."""
    if not re.fullmatch(r'[a-f0-9]{64}', candidate or '') or type(since) is not int:
        raise ValueError('home_timing_identity')
    # Never replace an existing alarm (in particular the browser rollback timer).
    if signal.getitimer(signal.ITIMER_REAL) != (0.0, 0.0):
        return None
    previous_handler = signal.getsignal(signal.SIGALRM)
    def timeout(*_):
        raise HomeTimingTimeout()
    connection = Docker()
    connection.timeout = HOME_TIMING_CAPTURE_SECONDS
    try:
        signal.signal(signal.SIGALRM, timeout)
        signal.setitimer(signal.ITIMER_REAL, HOME_TIMING_CAPTURE_SECONDS)
        target = '/containers/' + candidate + '/logs?' + urlencode({'stdout': 1, 'stderr': 1, 'follow': 0,
            'timestamps': 0, 'tail': HOME_TIMING_LOG_LINES, 'since': since, 'until': int(time.time()) + 1})
        connection.request('GET', target)
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError('home_timing_http')
        result = home_timing_rows(response.read(HOME_TIMING_LOG_BYTES + 1))
        return {'version': 1, 'kind': 'china-home-phase-timing-v1', 'runtimeSha': plan['runtimeSha'],
                'nonce': plan['nonce'], **result}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        connection.close()


def command(args, timeout=120):
    process = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             timeout=timeout, env={'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'})
    need(process.returncode == 0, 'command_failed')
    return process.stdout


def env_map(container):
    values = container['Config']['Env']
    need(isinstance(values, list) and all(isinstance(v, str) and '=' in v and '\n' not in v and '\r' not in v for v in values), 'environment')
    result = dict(v.split('=', 1) for v in values)
    need(len(result) == len(values), 'environment_duplicates')
    return result


def backend(raw):
    found = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', raw)
    need(len(found) == 1 and 3000 <= int(found[0]) < 4000, 'ingress_backend')
    return int(found[0])


def response_json(port, route, timeout=30):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        connection.request('GET', route, headers={'Host': 'avtocena.com', 'Accept': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        raw = response.read(20 * 1024 * 1024 + 1)
        need(response.status == 200 and len(raw) <= 20 * 1024 * 1024, 'http_response')
        return json.loads(raw)
    finally:
        connection.close()


def health(port, release):
    value = response_json(port, '/api/health', 5)
    need(value.get('ok') is True and value.get('releaseSha') == release and value.get('calculationVersion') == CALCULATION, 'health_identity')


def canonical_mounts(mounts):
    need(isinstance(mounts, list) and all(isinstance(row, dict) for row in mounts), 'mounts_shape')
    pairs = [(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False), row) for row in mounts]
    need(len({key for key, _ in pairs}) == len(pairs), 'mounts_duplicate')
    # Docker builds this array from a map. Preserve every attribute and every
    # row; only the order is immaterial to container identity.
    return [row for _, row in sorted(pairs, key=lambda pair: pair[0])]


def protected_identity(container):
    return {key: container[key] for key in ('Id', 'Image', 'Config', 'HostConfig')} | {
        'Mounts': canonical_mounts(container['Mounts']),
        'Pid': container['State']['Pid'], 'StartedAt': container['State']['StartedAt'],
        'RestartCount': container['RestartCount'], 'Running': container['State']['Running']}


def retained_snapshot_guard(original_ingress, actual_ingress, expected, actual, raw_mounts, code):
    current = protected_identity(actual)
    if original_ingress == actual_ingress and expected == current:
        return raw_mounts != actual['Mounts'] and canonical_mounts(raw_mounts) == current['Mounts']
    error = ReleaseError('china_host_' + code)
    pid = lambda value: value if type(value) is int and 0 <= value <= 2147483647 else None
    started = lambda value: value if isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z', value) else None
    error.retained_fence = {'version': 1, 'kind': 'china-host-retained-fence-v1',
        'ingressChanged': original_ingress != actual_ingress,
        'changedFields': [key for key in expected if expected[key] != current.get(key)],
        'mountOrderOnly': raw_mounts != actual['Mounts'] and canonical_mounts(raw_mounts) == current['Mounts'],
        'beforePid': pid(expected['Pid']), 'afterPid': pid(current['Pid']),
        'beforeStartedAt': started(expected['StartedAt']), 'afterStartedAt': started(current['StartedAt'])}
    raise error


def generation_update(plan):
    return plan.get('mode') == 'generation-update'


def code_update(plan):
    return plan.get('mode') == 'code-update'


def code_scope(plan):
    scope = plan.get('codeScope', PHOTO_CODE_SCOPE)
    need(isinstance(scope, str) and scope in CODE_SCOPE_FILES, 'code_scope')
    return scope


def japan_observed_timing(plan):
    return code_update(plan) and code_scope(plan) == JAPAN_STABILITY_CODE_SCOPE and \
        plan.get('acceptancePolicy') == JAPAN_OBSERVED_TIMING_POLICY



def checked_japan_stability_image_files(files, observed, retained_runtime=JAPAN_STABILITY_RETAINED, count_acceptance=None):
    """Both image admission phases use the same exact historical profiles."""
    need(isinstance(files, list) and all(isinstance(name, str) for name in files)
         and len(files) == len(set(files)), 'code_image_receipt')
    profiles = (JAPAN_STABILITY_CODE_FILES, JAPAN_STABILITY_UI_CODE_FILES, JAPAN_STABILITY_POWER_CODE_FILES,
                JAPAN_STABILITY_RAILS_CODE_FILES, JAPAN_STABILITY_HOME_CODE_FILES, JAPAN_STABILITY_METADATA_CODE_FILES,
                JAPAN_STABILITY_PRICE_SORT_CODE_FILES, JAPAN_STABILITY_EXACT_COUNT_CODE_FILES,
                JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES, JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES)
    selected = next((profile for profile in profiles if profile and set(files) == profile), None)
    need(selected is not None, 'code_image_receipt')
    need(retained_runtime == (JAPAN_STABILITY_MODEL_CURSOR_RETAINED if selected == JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES
                             else JAPAN_STABILITY_SOURCE_COUNT_RETAINED if selected == JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES
                             else JAPAN_STABILITY_EXACT_COUNT_RETAINED if selected == JAPAN_STABILITY_EXACT_COUNT_CODE_FILES
                             else JAPAN_STABILITY_PRICE_SORT_RETAINED if selected == JAPAN_STABILITY_PRICE_SORT_CODE_FILES
                             else JAPAN_STABILITY_RETAINED), 'code_stability_predecessor')
    need(type(observed) is bool and observed == (selected in
         (JAPAN_STABILITY_HOME_CODE_FILES, JAPAN_STABILITY_METADATA_CODE_FILES,
          JAPAN_STABILITY_PRICE_SORT_CODE_FILES, JAPAN_STABILITY_EXACT_COUNT_CODE_FILES,
          JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES, JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES)), 'timing_policy_image_scope')
    need((count_acceptance == JAPAN_SOURCE_COUNT_POLICY if selected in (JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES, JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES)
          else count_acceptance is None or (selected == JAPAN_STABILITY_EXACT_COUNT_CODE_FILES
          and count_acceptance == JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY)), 'count_acceptance_image_scope')
    return selected


def japan_source_bounded_acceptance_passed(report):
    return isinstance(report, dict) and report.get('countAcceptance') == JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY and \
        japan_model_coverage_acceptance_passed(report)


def japan_model_coverage_acceptance_passed(report):
    if not isinstance(report, dict):
        return False
    checks = report.get('checks')
    proof = checks.get('modelCoverage') if isinstance(checks, dict) else None
    return report.get('japanModelCoverageRequired') is True and report.get('japanModelCoveragePassed') is True and \
        report.get('japanExactCountRequired') is False and 'japanExactCountPassed' in report and \
        report['japanExactCountPassed'] is None and isinstance(proof, dict) and \
        type(proof.get('sourcePairs')) is int and 0 < proof['sourcePairs'] <= 9007199254740991 and \
        type(proof.get('accessiblePairs')) is int and proof['accessiblePairs'] == proof['sourcePairs'] and \
        proof.get('coverageContract') == 'directory-and-visible-cards-v1' and \
        type(proof.get('cardBackedExtraPairs')) is int and proof['cardBackedExtraPairs'] >= 0 and \
        type(proof.get('visibleCardPairs')) is int and 1 <= proof['visibleCardPairs'] <= 24 and \
        proof['cardBackedExtraPairs'] <= proof['visibleCardPairs'] and \
        type(proof.get('optionPairs')) is int and 0 < proof['optionPairs'] <= 9007199254740991 and \
        proof['optionPairs'] == proof['sourcePairs'] + proof['cardBackedExtraPairs'] and \
        proof.get('uiEqualsDirectory') is (proof['cardBackedExtraPairs'] == 0) and \
        proof.get('allOptionsSourceBacked') is True and \
        all(proof.get(key) is True for key in ('allSourceModelsAccessible', 'noForeignModels', 'sourceMatchesUi',
            'typedFamilyNotNarrowed', 'countHonest', 'fullPage')) and \
        proof.get('make') in ('AUDI', 'Audi') and proof.get('typedBase') == 'A4' and \
        all(isinstance(proof.get(key), str) and re.fullmatch(r'[a-f0-9]{64}', proof[key]) is not None for key in
            ('pairsSha256', 'optionPairsSha256', 'cardBackedExtraPairsSha256', 'visibleCardPairsSha256', 'cardProvenanceSha256')) and \
        (proof['optionPairsSha256'] == proof['pairsSha256']) == proof['uiEqualsDirectory'] and \
        type(proof.get('modelExpansions')) is int and proof['modelExpansions'] >= 0 and \
        (proof['modelExpansions'] > 0) == (proof['optionPairs'] > 60) and \
        proof['modelExpansions'] <= (proof['optionPairs'] + 59) // 60 - 1 and \
        type(proof.get('sourceFamilyModels')) is int and 0 < proof['sourceFamilyModels'] <= proof['sourcePairs'] and \
        isinstance(proof.get('directory'), dict) and proof['directory'].get('status') == 200 and \
        proof['directory'].get('stale') is False and type(proof['directory'].get('sourcePairs')) is int and \
        proof['directory']['sourcePairs'] == proof['sourcePairs'] and \
        proof['directory'].get('pairsSha256') == proof['pairsSha256'] and \
        proof['directory'].get('browserMatchesApi') is True and \
        isinstance(proof.get('selection'), dict) and type(proof['selection'].get('shown')) is int and \
        1 <= proof['selection']['shown'] <= 24 and proof['selection'].get('observedSourceNamesOnly') is True and \
        type(proof.get('explicitApiReads')) is int and proof['explicitApiReads'] == 3 and \
        proof.get('liveExhaustiveScan') is False and type(proof.get('pageErrors')) is int and proof['pageErrors'] == 0


def source_count_cursor(value):
    if not isinstance(value, str) or len(value) > 320:
        return False
    ordinary = re.fullmatch(r'j1\.([1-9]\d{0,6})\.(\d{1,2})\.([1-9]\d{0,6})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})', value)
    if ordinary:
        return int(ordinary[1]) <= 1000000 and int(ordinary[2]) <= 23 and int(ordinary[3]) <= 1000000 and \
            (int(ordinary[2]) == 0) == (ordinary[5] == '-')
    power = re.fullmatch(r'j2\.([ku])\.([1-9]\d{0,6})\.(\d{1,2})\.([1-9]\d{0,6})\.([a-f0-9]{64})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})', value)
    return bool(power) and int(power[2]) <= 1000000 and int(power[3]) <= 24 and int(power[4]) <= 1000000 and \
        (int(power[3]) == 0) == (power[7] == '-')


def japan_source_count_acceptance_passed(report):
    if not isinstance(report, dict) or not japan_model_coverage_acceptance_passed(report):
        return False
    proof = report.get('checks', {}).get('sourceCount')
    if not isinstance(proof, dict):
        return False
    summary, ui, pagination = proof.get('summary'), proof.get('ui'), proof.get('pagination')
    if not all(isinstance(value, dict) for value in (summary, ui, pagination)):
        return False
    source = summary.get('sourceCountProof')
    if not isinstance(source, dict):
        return False
    integer = lambda value: type(value) is int and 0 <= value <= 9007199254740991
    hash64 = lambda value: isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None
    try:
        checked_at = datetime.datetime.fromisoformat(report['checkedAt'].replace('Z', '+00:00'))
        observed_at = datetime.datetime.fromisoformat(summary['observedAt'].replace('Z', '+00:00'))
        age = (checked_at - observed_at).total_seconds()
    except (KeyError, TypeError, ValueError, AttributeError):
        return False
    total = summary.get('total')
    total_text = f'{total:,}'.replace(',', ' ') if integer(total) else None
    # This is the counter's data freshness contract, not a request speed test.
    return report.get('countAcceptance') == JAPAN_SOURCE_COUNT_POLICY and \
        report.get('japanSourceCountRequired') is True and report.get('japanSourceCountPassed') is True and \
        proof.get('contract') == 'japan-source-count-browser-v1' and integer(total) and total > 0 and \
        summary.get('stale') is False and summary.get('upperBound') is True and \
        summary.get('precision') == 'source-upper-bound' and summary.get('selectionScope') == 'source-candidates' and \
        type(summary.get('sourceScopeComplete')) is bool and \
        all(key not in summary for key in ('countProof', 'knownTotal', 'unknownTotal')) and \
        type(source.get('version')) is int and source['version'] == 1 and source.get('kind') == 'japan-source-count' and \
        source.get('predicateVersion') == 'japan-source-candidates-v1' and \
        all(hash64(source.get(key)) for key in ('requestedQueryHash', 'sourceQueryHash', 'evidenceEpoch')) and \
        integer(source.get('sourceTotal')) and source['sourceTotal'] == total and \
        source.get('sourceObservedAt') == summary['observedAt'] and \
        source.get('sourceScopeComplete') is summary['sourceScopeComplete'] and type(source.get('directoryComplete')) is bool and \
        (not source['sourceScopeComplete'] or source['directoryComplete']) and 0 <= age < 30 * 60 and \
        proof.get('queryHashVerified') is True and proof.get('independentCount') is True and \
        'admittedTotal' in proof and proof['admittedTotal'] is None and proof.get('positiveAdmittedCensusClaimed') is False and \
        ui.get('status') == ('bounded' if source['sourceScopeComplete'] else 'source') and \
        integer(ui.get('sourceTotal')) and ui['sourceTotal'] == total and \
        ui.get('requestedQueryHash') == source['requestedQueryHash'] and ui.get('observedAt') == summary['observedAt'] and \
        integer(ui.get('loadedCount')) and 1 <= ui['loadedCount'] <= 24 and ui['sourceTotal'] >= ui['loadedCount'] and isinstance(ui.get('label'), str) and \
        ui['label'].replace('\u00a0', ' ').replace('\u202f', ' ') == \
            ('Найдено до ' if source['sourceScopeComplete'] else 'В источнике: ') + total_text and \
        pagination.get('sameFilter') is True and source_count_cursor(pagination.get('cursorBeforeCount')) and \
        pagination.get('cursorAfterCount') == pagination['cursorBeforeCount'] and \
        pagination.get('continuationCursor') == pagination['cursorBeforeCount'] and pagination.get('continuationFollowed') is True and \
        integer(pagination.get('loadedBefore')) and pagination['loadedBefore'] == ui['loadedCount'] and \
        integer(pagination.get('loadedAfter')) and pagination['loadedBefore'] < pagination['loadedAfter'] <= pagination['loadedBefore'] + 24 and \
        type(pagination.get('duplicateIds')) is int and pagination['duplicateIds'] == 0 and pagination.get('freshSourcePages') is True and \
        proof.get('liveExhaustiveScan') is False and type(proof.get('pageErrors')) is int and proof['pageErrors'] == 0


def japan_a4_power160_continuation_acceptance_passed(report):
    if not japan_source_count_acceptance_passed(report):
        return False
    proof = report.get('checks', {}).get('a4Power160Continuation')
    if not isinstance(proof, dict):
        return False
    selection, navigation, attempts = proof.get('selection'), proof.get('firstPageNavigation'), proof.get('attempts')
    if not isinstance(selection, dict) or not isinstance(navigation, dict) or not isinstance(attempts, list):
        return False
    hash64 = lambda value: isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None
    page_size = lambda value: type(value) is int and 1 <= value <= 24
    try:
        checked_at = datetime.datetime.fromisoformat(report['checkedAt'].replace('Z', '+00:00'))
    except (KeyError, TypeError, ValueError, AttributeError):
        return False

    def page_passed(page, shown):
        if not isinstance(page, dict):
            return False
        try:
            observed_at = datetime.datetime.fromisoformat(page['observedAt'].replace('Z', '+00:00'))
            age = (checked_at - observed_at).total_seconds()
        except (KeyError, TypeError, ValueError, AttributeError):
            return False
        # Data timestamps are observed evidence; browser duration is not a gate.
        return type(page.get('status')) is int and page['status'] == 200 and \
            page_size(shown) and type(page.get('shown')) is int and page['shown'] == shown and 0 <= age < 30 * 60 and \
            page.get('stale') is False and page.get('interrupted') is False and \
            all(type(page.get(key)) is bool for key in ('partial', 'scanLimited', 'selectionIncomplete', 'hasMore')) and \
            (not page['scanLimited'] or page['hasMore'] and page['shown'] < 24) and \
            type(page.get('sourcePages')) is int and 1 <= page['sourcePages'] <= 8 and \
            hash64(page.get('receiptsSha256')) and page.get('sourceReceiptsFresh') is True and \
            'total' in page and page['total'] is None and page.get('selectionCompletenessClaimed') is False

    def rendered_page_passed(page, shown, index):
        if not isinstance(page, dict):
            return False
        try:
            observed_at = datetime.datetime.fromisoformat(page['observedAt'].replace('Z', '+00:00'))
            age = (checked_at - observed_at).total_seconds()
        except (KeyError, TypeError, ValueError, AttributeError):
            return False
        return page.get('kind') == 'rendered-ssr' and 'status' in page and \
            (type(page['status']) is int and page['status'] == 200 or index == 0 and page['status'] is None) and \
            page_size(shown) and type(page.get('shown')) is int and page['shown'] == shown and \
            type(page.get('page')) is int and page['page'] == 1 and \
            page.get('afterSha256') == 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' and \
            page.get('ssrBindingMatched') is True and 0 <= age < 30 * 60 and page.get('stale') is False and \
            all(key in page and page[key] is None for key in ('partial', 'scanLimited', 'selectionIncomplete', 'interrupted')) and \
            type(page.get('sourcePages')) is int and 1 <= page['sourcePages'] <= 8 and \
            hash64(page.get('receiptsSha256')) and page.get('sourceReceiptsFresh') is True and \
            'total' in page and page['total'] is None and page.get('hasMore') is True and \
            page.get('selectionCompletenessClaimed') is False

    names = ('after_power_toggle', 'after_first_page_navigation')
    if len(attempts) != len(names):
        return False
    for index, (attempt, name) in enumerate(zip(attempts, names)):
        if not isinstance(attempt, dict):
            return False
        cursor = attempt.get('cursor')
        if not (attempt.get('name') == name and type(attempt.get('status')) is int and attempt['status'] == 200 and
                attempt.get('sameFilter') is True and isinstance(cursor, str) and cursor.startswith('j2.') and
                source_count_cursor(cursor) and attempt.get('continuationCursor') == cursor and
                page_size(attempt.get('loadedBefore')) and page_size(attempt.get('added')) and
                type(attempt.get('loadedAfter')) is int and attempt['loadedAfter'] == attempt['loadedBefore'] + attempt['added'] and
                type(attempt.get('duplicateIds')) is int and attempt['duplicateIds'] == 0 and
                all(attempt.get(key) is True for key in ('oldIdsPreserved', 'orderPreserved', 'knownBeforeUnknown')) and
                rendered_page_passed(attempt.get('firstPage'), attempt['loadedBefore'], index) and
                page_passed(attempt.get('nextPage'), attempt['added']) and
                all(hash64(attempt.get(key)) for key in ('beforeIdsSha256', 'addedIdsSha256', 'afterIdsSha256'))):
            return False
    return report.get('japanA4Power160ContinuationRequired') is True and report.get('japanA4Power160ContinuationPassed') is True and \
        proof.get('contract') == 'japan-a4-power160-continuation-browser-v1' and \
        selection.get('market') == 'japan' and selection.get('make') == 'Audi' and selection.get('model') == 'A4' and \
        selection.get('city') == 'Новокузнецк' and type(selection.get('powerTo')) is int and selection['powerTo'] == 160 and \
        proof.get('toggledThroughUi') is True and type(navigation.get('status')) is int and navigation['status'] == 200 and \
        all(navigation.get(key) is True for key in ('sameFilter', 'powerChecked', 'cityPreserved')) and \
        type(proof.get('explicitApiReads')) is int and proof['explicitApiReads'] == 0 and \
        type(proof.get('ordinaryAppendRequests')) is int and proof['ordinaryAppendRequests'] == 2 and \
        type(proof.get('firstPageNavigations')) is int and proof['firstPageNavigations'] == 1 and \
        proof.get('fullSelectionExhaustionClaimed') is False and proof.get('liveExhaustiveScan') is False and \
        type(proof.get('pageErrors')) is int and proof['pageErrors'] == 0


def observed_timing_fields(value):
    return value.get('timingPolicy') == JAPAN_OBSERVED_TIMING_POLICY and \
        value.get('speedGateRequired') is False and 'speedPassed' in value and \
        value['speedPassed'] is None and value.get('timingObserved') is True


def accepted_update(plan):
    return generation_update(plan) or code_update(plan)


def expected_files(plan):
    if code_update(plan):
        return CODE_UPLOAD_FILES
    return FILE_NAMES - {'image.tar'} if generation_update(plan) else FILE_NAMES


def described_files(plan):
    return expected_files(plan) | GENERATION_FILES if code_update(plan) else expected_files(plan)


def require_generation_space(directory, additional_bytes=0):
    """Re-observe actual available blocks before a data-update disk write."""
    need(type(additional_bytes) is int and additional_bytes >= 0, 'generation_disk_request')
    usage = os.statvfs(directory)
    available = usage.f_bavail * usage.f_frsize
    need(available >= additional_bytes + RELEASE_DISK_OPERATING_RESERVE, 'generation_disk_space')
    return available


def generation_disk_admission(plan, directory):
    need(generation_update(plan), 'generation_capacity_mode')
    raw_bytes = sum(item['bytes'] for item in plan['files'])
    compressed_bytes = max(item['compressedBytes'] for item in plan['files'])
    # Upload order is unrestricted: the largest compressed input may be last,
    # while every raw file (including its own decoded bytes) is still present.
    available = require_generation_space(directory, raw_bytes + compressed_bytes)
    return {'kind': 'china-generation-disk-admission-v1', 'uploadedRawBytes': raw_bytes,
            'largestCompressedBytes': compressed_bytes, 'operatingReserveBytes': RELEASE_DISK_OPERATING_RESERVE,
            'requiredBytes': raw_bytes + compressed_bytes + RELEASE_DISK_OPERATING_RESERVE,
            'availableDiskBytes': available}


def retained_runtime(plan):
    return plan.get('retainedRuntime', RETAINED)


def accepted_reference_receipt(reference):
    need(isinstance(reference, dict), 'predecessor_reference')
    proof = reference.get('proof')
    need(reference.get('market') == 'china' and isinstance(proof, dict) and
         proof.get('kind') == 'china-accepted-proof-v1', 'predecessor_proof')
    raw, receipt = decode_report(proof.get('hostReceiptBase64'))
    need(len(raw) <= 48 * 1024 and sha(raw) == proof.get('hostReceiptSha256') and
         receipt.get('version') == 1 and receipt.get('kind') == 'china-host-acceptance-v1' and
         re.fullmatch(r'[a-f0-9]{32}', receipt.get('nonce', '')), 'predecessor_proof_hash')
    bindings = {'runtimeSha': 'release', 'pricingRuntimeSha': 'pricingRuntimeSha', 'imageId': 'imageId',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'receiptSha256': 'privateGenerationReceiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256',
                'sourceCursor': 'sourceCursor', 'sourceObservedAt': 'sourceObservedAt'}
    need(all(reference.get(left) == receipt.get(right) and left in reference and right in receipt
             for left, right in bindings.items()), 'predecessor_reference')
    return receipt, raw


def accepted_predecessor(plan):
    """Authenticate the exact supplied state observation against its retained
    host receipt. Local receipt and mounted-generation checks happen at start."""
    state = plan.get('previousAcceptedState')
    need(isinstance(state, dict) and state.get('version') == 1 and
         state.get('kind') == 'china-accepted-state-v1' and state.get('market') == 'china' and
         type(state.get('revision')) is int and state['revision'] > 0 and state.get('pending') is None and
         isinstance(state.get('current'), dict), 'predecessor_state')
    need(canonical_sha(state) == plan.get('previousAcceptedStateSha256') and
         isinstance(plan.get('previousAcceptedETag'), str), 'predecessor_state_hash')
    reference = state['current']
    receipt, raw = accepted_reference_receipt(reference)
    commit = state.get('commit')
    need(isinstance(commit, dict) and commit.get('nonce') == receipt['nonce'] and
         commit.get('acceptedAt') == receipt.get('acceptedAt'), 'predecessor_commit')
    need(plan.get('retainedRuntime') == reference.get('runtimeSha') and plan.get('nonce') != receipt['nonce'],
         'predecessor_identity')
    if code_update(plan):
        bindings = {'pricingRuntimeSha': 'pricingRuntimeSha', 'generationId': 'generationId',
                    'generationManifestSha256': 'generationManifestSha256',
                    'privateGenerationReceiptSha256': 'receiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256'}
        need(plan.get('runtimeSha') != reference.get('runtimeSha') and plan.get('imageId') != reference.get('imageId') and
             all(plan.get(left) == reference.get(right) for left, right in bindings.items()), 'code_only_identity')
    else:
        need(all(plan.get(key) == reference.get(key) for key in ('runtimeSha', 'pricingRuntimeSha', 'imageId')) and
             plan.get('generationId') != reference.get('generationId'), 'data_only_identity')
    return reference, receipt, raw


def validate_plan(plan):
    need(plan.get('mode') in (None, 'generation-update', 'code-update'), 'plan_mode')
    if 'acceptancePolicy' in plan:
        need(japan_observed_timing(plan), 'timing_policy_scope')
    if 'countAcceptance' in plan:
        need(japan_observed_timing(plan) and
             ((plan.get('retainedRuntime') == JAPAN_STABILITY_EXACT_COUNT_RETAINED and
               plan['countAcceptance'] == JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY) or
              (plan.get('retainedRuntime') in (JAPAN_STABILITY_SOURCE_COUNT_RETAINED, JAPAN_STABILITY_MODEL_CURSOR_RETAINED) and
               plan['countAcceptance'] == JAPAN_SOURCE_COUNT_POLICY)), 'count_acceptance_scope')
    need(plan.get('version') == 1 and plan.get('market') == 'china' and
         (accepted_update(plan) or plan.get('retainedRuntime') == RETAINED) and
         plan.get('servingCalculationVersion') == CALCULATION, 'plan_scope')
    for key in ('runtimeSha', 'pricingRuntimeSha', 'runtimeTree', 'controllerSha'):
        need(re.fullmatch(r'[a-f0-9]{40}', plan.get(key, '')), 'plan_revision')
    for key in ('runtimeDiffSha256', 'generationManifestSha256', 'privateGenerationReceiptSha256', 'sourceDescriptorSha256'):
        need(re.fullmatch(r'[a-f0-9]{64}', plan.get(key, '')), 'plan_digest')
    need(re.fullmatch(r'gen_china_[1-9]\d*_[1-9]\d*', plan.get('generationId', '')) and
         re.fullmatch(r'[a-f0-9]{32}', plan.get('nonce', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', plan.get('imageId', '')), 'plan_identity')
    files = plan.get('files', [])
    required = described_files(plan)
    need(isinstance(files, list) and {f['name'] for f in files} == required and len(files) == len(required), 'plan_files')
    for file in files:
        need(type(file.get('bytes')) is int and file['bytes'] > 0 and re.fullmatch(r'[a-f0-9]{64}', file.get('sha256', '')) and
             type(file.get('compressedBytes')) is int and file['compressedBytes'] > 0 and
             re.fullmatch(r'[a-f0-9]{64}', file.get('compressedSha256', '')), 'plan_file')
    need(next(f for f in files if f['name'] == 'GENERATION.json')['sha256'] == plan['generationManifestSha256'], 'plan_generation')
    need(next(f for f in files if f['name'] == 'accepted-speed-baseline.json')['sha256'] ==
         '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59', 'speed_baseline')
    previous_etag, previous_sha = plan.get('previousAcceptedETag'), plan.get('previousAcceptedStateSha256')
    need((previous_etag is None and previous_sha is None) or
         (isinstance(previous_etag, str) and re.fullmatch(r'"[^"\x00-\x20\x7f]{1,250}"', previous_etag) and
          isinstance(previous_sha, str) and re.fullmatch(r'[a-f0-9]{64}', previous_sha)), 'previous_state')
    if accepted_update(plan):
        reference, _, _ = accepted_predecessor(plan)
        if plan.get('countAcceptance') == JAPAN_SOURCE_COUNT_POLICY:
            need((reference.get('runtimeSha'), reference.get('imageId')) in (
                 (JAPAN_STABILITY_SOURCE_COUNT_RETAINED, JAPAN_STABILITY_SOURCE_COUNT_RETAINED_IMAGE),
                 (JAPAN_STABILITY_MODEL_CURSOR_RETAINED, JAPAN_STABILITY_MODEL_CURSOR_RETAINED_IMAGE)),
                 'source_count_retained_image')
        if code_update(plan):
            scope = code_scope(plan)
            need(scope not in (JAPAN_COMPLETION_CODE_SCOPE, JAPAN_COMPLETION_V2_CODE_SCOPE)
                 or plan.get('retainedRuntime') == JAPAN_COMPLETION_RETAINED,
                 'code_completion_predecessor')
            need(scope != JAPAN_USABILITY_CODE_SCOPE or plan.get('retainedRuntime') == JAPAN_USABILITY_RETAINED,
                 'code_usability_predecessor')
            need(scope not in (CRM_CHINA_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_SCOPE)
                 or plan.get('retainedRuntime') == CRM_CHINA_RETAINED,
                 'code_crm_predecessor')
            need(scope != JAPAN_PAGINATION_CODE_SCOPE or plan.get('retainedRuntime') == JAPAN_PAGINATION_RETAINED,
                 'code_pagination_predecessor')
            need(scope != JAPAN_STABILITY_CODE_SCOPE or
                 (plan.get('retainedRuntime') in (JAPAN_STABILITY_RETAINED, JAPAN_STABILITY_PRICE_SORT_RETAINED,
                                               JAPAN_STABILITY_EXACT_COUNT_RETAINED, JAPAN_STABILITY_SOURCE_COUNT_RETAINED,
                                               JAPAN_STABILITY_MODEL_CURSOR_RETAINED) and
                  bool(JAPAN_STABILITY_CODE_FILES) and JAPAN_PAGINATION_CODE_FILES <= JAPAN_STABILITY_CODE_FILES),
                 'code_stability_predecessor')
            need(all(isinstance(plan.get(key), str) and re.fullmatch(r'[a-f0-9]{64}', plan[key])
                     for key in ('codeSourcePlanSha256', 'codeSourceOracleSha256')), 'code_source_binding')
    else:
        need('previousAcceptedState' not in plan, 'unexpected_predecessor')
    # Existing accepted/rollback records predate storage proofs. Their original
    # PLAN bytes remain valid history; only a new code Host init requires one.
    if 'codeImageStorageProof' in plan:
        checked_code_image_storage_proof(plan)


def checked_code_image_storage_proof(plan, image_receipt=None):
    proof = plan.get('codeImageStorageProof')
    keys = {'version', 'kind', 'imageId', 'runtimeSha', 'runtimeTree', 'runtimeDiffSha256', 'platform',
            'archiveBytes', 'archiveSha256', 'imageReceiptSha256', 'configSha256', 'rootFsSha256',
            'manifestId', 'contentBytes', 'unpackedBytes', 'totalBytes', 'builder'}
    need(code_update(plan) and isinstance(proof, dict) and set(proof) == keys and
         proof.get('version') == 1 and proof.get('kind') == 'china-image-storage-v1', 'code_storage_proof')
    files = {row['name']: row for row in plan['files']}
    need(all(proof.get(key) == plan.get(key) for key in ('imageId', 'runtimeSha', 'runtimeTree', 'runtimeDiffSha256')) and
         isinstance(proof.get('manifestId'), str) and re.fullmatch(r'sha256:[a-f0-9]{64}', proof['manifestId']) and
         proof.get('platform') == 'linux/amd64' and
         all(isinstance(proof.get(key), str) and re.fullmatch(r'[a-f0-9]{64}', proof[key])
             for key in ('archiveSha256', 'imageReceiptSha256', 'configSha256', 'rootFsSha256')) and
         proof.get('archiveBytes') == files['image.tar']['bytes'] and
         proof.get('archiveSha256') == files['image.tar']['sha256'] and
         proof.get('imageReceiptSha256') == files['image-receipt.json']['sha256'], 'code_storage_binding')
    need(proof.get('builder') == {'version': '29.1.3', 'driver': 'overlayfs', 'driverType': 'io.containerd.snapshotter.v1'},
         'code_storage_builder')
    need(all(type(proof.get(key)) is int and 0 < proof[key] <= 9007199254740991
             for key in ('archiveBytes', 'contentBytes', 'unpackedBytes', 'totalBytes')) and
         proof['contentBytes'] <= proof['archiveBytes'] and
         proof['totalBytes'] == proof['contentBytes'] + proof['unpackedBytes'], 'code_storage_bytes')
    if image_receipt is not None:
        need(all(proof[key] == image_receipt.get(key) for key in
                 ('imageId', 'runtimeSha', 'runtimeTree', 'runtimeDiffSha256', 'configSha256', 'rootFsSha256', 'platform', 'builder')) and
             proof['archiveBytes'] == image_receipt.get('bytes') and proof['archiveSha256'] == image_receipt.get('sha256'),
             'code_storage_receipt')
    return proof


def decode_report(value):
    need(isinstance(value, str) and len(value) <= 350000, 'browser_evidence_size')
    try:
        raw = base64.b64decode(value, validate=True)
        decoded = json.loads(raw)
    except (ValueError, TypeError):
        raise ReleaseError('china_host_browser_evidence_encoding') from None
    need(0 < len(raw) <= 256 * 1024 and isinstance(decoded, dict) and base64.b64encode(raw).decode() == value,
         'browser_evidence_encoding')
    return raw, decoded


def private_directory(directory):
    need(directory.resolve() == directory and directory.is_dir() and directory.stat().st_uid == 0 and
         not directory.stat().st_mode & 0o022, 'recovery_directory')


def diagnosis_json(filename):
    """Only bounded metadata is read here; never checksum the uploaded databases."""
    before = regular(filename, 256 * 1024)
    raw = filename.read_bytes()
    after = regular(filename, 256 * 1024)
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'diagnosis_file_changed')
    value = json.loads(raw)
    need(isinstance(value, dict), 'diagnosis_json')
    return value, raw


def diagnosis_events(plan, since, until):
    """Docker's bounded historical event buffer may outlive a removed container.
    Return only fixed event names, times, numeric exit codes and OOM flags."""
    actions = {'create', 'start', 'die', 'oom', 'stop', 'kill', 'destroy', 'restart'}
    filters = {'type': ['container'], 'label': ['avtocena.china.nonce=' + plan['nonce'],
               'org.opencontainers.image.revision=' + plan['runtimeSha']], 'event': sorted(actions)}
    target = '/events?' + urlencode({'since': str(since), 'until': str(until), 'filters': json.dumps(filters)})
    connection = Docker()
    connection.timeout = 15
    try:
        connection.request('GET', target)
        response = connection.getresponse()
        raw = response.read(1024 * 1024 + 1)
        need(response.status == 200 and len(raw) <= 1024 * 1024, 'diagnosis_events_response')
        rows = []
        for line in raw.splitlines():
            value = json.loads(line)
            attributes = value.get('Actor', {}).get('Attributes', {})
            action, when = value.get('Action'), value.get('time')
            need(value.get('Type') == 'container' and action in actions and type(when) is int and since <= when <= until and
                 attributes.get('avtocena.china.nonce') == plan['nonce'] and
                 attributes.get('org.opencontainers.image.revision') == plan['runtimeSha'], 'diagnosis_event_scope')
            exit_code = attributes.get('exitCode')
            need(exit_code is None or (isinstance(exit_code, str) and re.fullmatch(r'-?\d{1,8}', exit_code)),
                 'diagnosis_event_exit')
            rows.append({'action': action, 'time': when, 'exitCode': int(exit_code) if exit_code is not None else None,
                         'oom': action == 'oom'})
            need(len(rows) <= 512, 'diagnosis_events_bound')
        return {'available': True, 'reason': None if rows else 'empty', 'rows': rows}
    except Exception:
        # No Docker response, daemon error, arbitrary label or raw log escapes.
        return {'available': False, 'reason': 'unavailable', 'rows': []}
    finally:
        connection.close()


def saved_startup_diagnosis(directory):
    filename = directory / 'STARTUP.json'
    if not filename.exists():
        return None
    value, _ = diagnosis_json(filename)
    keys = {'version', 'kind', 'ready', 'elapsedSeconds', 'attempts', 'health', 'candidate', 'reason'}
    need(set(value) == keys and value.get('version') == 1 and value.get('kind') == 'china-host-startup-v1' and
         type(value.get('ready')) is bool and type(value.get('elapsedSeconds')) in (int, float) and
         math.isfinite(value['elapsedSeconds']) and 0 <= value['elapsedSeconds'] <= 3600 and
         type(value.get('attempts')) is int and 0 <= value['attempts'] <= 10000 and
         value.get('health') in {'not_checked', 'ok', 'connection_refused', 'timeout', 'invalid_json', 'identity_mismatch',
                                 'http_response', 'connection_error', 'unavailable'} and
         value.get('reason') in {'ready', 'timeout', 'exited', 'oom', 'restarted', 'inspect_unavailable'} and
         value['ready'] == (value['reason'] == 'ready') and (not value['ready'] or value['health'] == 'ok'), 'diagnosis_startup')
    candidate = value['candidate']
    need(candidate is None or (isinstance(candidate, dict) and set(candidate) == {'running', 'status', 'exitCode', 'oomKilled', 'restartCount'} and
         type(candidate.get('running')) is bool and type(candidate.get('oomKilled')) is bool and
         type(candidate.get('exitCode')) is int and abs(candidate['exitCode']) <= 2147483647 and
         type(candidate.get('restartCount')) is int and 0 <= candidate['restartCount'] <= 10000 and
         candidate.get('status') in {'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'}), 'diagnosis_startup')
    return value


def saved_speed_sample(row, paths):
    need(isinstance(row, dict), 'diagnosis_speed_sample')
    phases = {'warm', 'after_ttl', 'after_directory_ttl'}
    def numbers(names):
        need(all(type(row.get(name)) in (int, float) and math.isfinite(row[name]) and 0 <= row[name] <= 86400
                 for name in names), 'diagnosis_speed_number')
        return {name: row[name] for name in names}
    def booleans(names):
        need(all(type(row.get(name)) is bool for name in names), 'diagnosis_speed_boolean')
        return {name: row[name] for name in names}
    if row.get('performanceGate') == 'summary':
        need(row.get('marketScope') == 'china' and
             all(isinstance(row.get(name), list) and len(row[name]) <= 64 and all(path in paths for path in row[name])
                 for name in ('routes', 'acceptedBaselineRoutes')) and
             all(type(row.get(name)) is int and 0 <= row[name] <= 10000 for name in ('samples', 'slowSamples')),
             'diagnosis_speed_summary')
        return {'performanceGate': 'summary', 'marketScope': 'china', 'routes': list(row['routes']),
                'acceptedBaselineRoutes': list(row['acceptedBaselineRoutes']), 'samples': row['samples'], 'slowSamples': row['slowSamples'],
                **booleans(('functionalPassed', 'performanceAccepted', 'latencyBlocking', 'acceptedBaselineEnforced'))}
    need(isinstance(row.get('path'), str) and row['path'] in paths, 'diagnosis_speed_route')
    route = {'path': row['path']}
    if row.get('performanceRequest') in {'started', 'complete', 'failed'}:
        result = {**route, 'performanceRequest': row['performanceRequest']}
        if row['performanceRequest'] != 'started':
            result.update(numbers(('seconds',)))
        if row['performanceRequest'] == 'complete':
            result.update(booleans(('functionalPassed',)))
        if row['performanceRequest'] == 'failed':
            errors = {'AssertionError', 'HTTPError', 'URLError', 'TimeoutError', 'JSONDecodeError', 'RemoteDisconnected',
                      'IncompleteRead', 'ConnectionResetError', 'ConnectionRefusedError', 'ValueError', 'KeyError', 'TypeError',
                      'OSError', 'SSLError', 'UnicodeDecodeError'}
            result['errorType'] = row.get('errorType') if row.get('errorType') in errors else 'other'
        return result
    if row.get('speedBaseline') in phases:
        result = {**route, 'speedBaseline': row['speedBaseline'],
                  **numbers(('referenceSeconds', 'measurementNoiseSeconds', 'ceilingSeconds', 'seconds')),
                  **booleans(('blocking', 'passed'))}
        if 'recheckSeconds' in row or 'recheckMedianSeconds' in row:
            values = row.get('recheckSeconds')
            need(isinstance(values, list) and len(values) == 3 and
                 all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 86400 for value in values),
                 'diagnosis_speed_recheck')
            result.update(recheckSeconds=list(values), **numbers(('recheckMedianSeconds',)))
        return result
    if row.get('performanceGate') in phases:
        return {**route, 'performanceGate': row['performanceGate'], **numbers(('seconds', 'ceiling')),
                **booleans(('passed', 'functionalPassed', 'latencyBlocking'))}
    raise ReleaseError('china_host_diagnosis_speed_sample')


def saved_speed_diagnosis(directory, plan):
    filename = directory / 'server-speed-result.json'
    if not filename.exists():
        return {'present': False, 'sha256': None, 'exitCode': None, 'samples': [], 'rejectedSamples': 0}
    # Authenticate the exact uploaded gate and frozen reference before exposing
    # only their known public route/sample fields. Neither file is executed.
    for name in ('regcloud-performance-gate.py', 'accepted-speed-baseline.json'):
        expected = next(row for row in plan['files'] if row['name'] == name)
        regular(directory / name, 256 * 1024)
        raw = (directory / name).read_bytes()
        need(len(raw) == expected['bytes'] and sha(raw) == expected['sha256'], 'diagnosis_speed_source')
    baseline, _ = diagnosis_json(directory / 'accepted-speed-baseline.json')
    paths = {row['path'] for row in baseline['samples']}
    paths.add('/cars?market=china')
    value, raw = diagnosis_json(filename)
    need(set(value) == {'exitCode', 'samples'} and type(value.get('exitCode')) is int and -255 <= value['exitCode'] <= 255 and
         isinstance(value.get('samples'), list) and len(value['samples']) <= 512, 'diagnosis_speed_report')
    samples = []
    rejected = 0
    for row in value['samples']:
        try:
            samples.append(saved_speed_sample(row, paths))
        except (ReleaseError, TypeError, ValueError):
            rejected += 1
    return {'present': True, 'sha256': sha(raw), 'exitCode': value['exitCode'], 'samples': samples, 'rejectedSamples': rejected}


def diagnose_startup(params):
    """Inspect exactly one failed first-release upload. No init, start, stop,
    file write, application request, state mutation or image load is reachable."""
    keys = {'runtimeSha', 'pricingRuntimeSha', 'generationId', 'generationManifestSha256',
            'controllerSha', 'imageId', 'since', 'until'}
    need(isinstance(params, dict) and set(params) == keys, 'diagnosis_selector')
    for name in ('runtimeSha', 'pricingRuntimeSha', 'controllerSha'):
        need(isinstance(params[name], str) and re.fullmatch(r'[a-f0-9]{40}', params[name]), 'diagnosis_selector')
    need(re.fullmatch(r'gen_china_[1-9]\d*_[1-9]\d*', params.get('generationId', '')) and
         re.fullmatch(r'[a-f0-9]{64}', params.get('generationManifestSha256', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', params.get('imageId', '')), 'diagnosis_selector')
    times = []
    for name in ('since', 'until'):
        need(isinstance(params[name], str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', params[name]),
             'diagnosis_window')
        times.append(int(datetime.datetime.fromisoformat(params[name].replace('Z', '+00:00')).timestamp()))
    since, until = times
    need(0 < until - since <= 300 and until <= int(time.time()), 'diagnosis_window')
    parent = BASE / params['runtimeSha'] / 'china-next'
    for directory in (BASE, parent.parent, parent):
        private_directory(directory)
    children = list(parent.iterdir())
    need(len(children) <= 200, 'diagnosis_directory_bound')
    matches = []
    for directory in children:
        if not re.fullmatch(r'[a-f0-9]{32}', directory.name):
            continue
        private_directory(directory)
        plan_file = directory / 'PLAN.json'
        if not plan_file.exists():
            continue
        plan, raw = diagnosis_json(plan_file)
        if all(plan.get(key) == params[key] for key in keys - {'since', 'until'}):
            validate_plan(plan)
            need(not generation_update(plan) and plan['nonce'] == directory.name, 'diagnosis_plan')
            matches.append((directory, plan, raw))
    need(len(matches) == 1, 'diagnosis_unique_plan')
    directory, plan, plan_raw = matches[0]
    need(not (directory / 'ACCEPTED.json').exists() and not (directory / 'ACCEPTED.pending').exists(), 'diagnosis_accepted')
    rollback, rollback_raw = diagnosis_json(directory / 'ROLLED_BACK.json')
    bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'imageId': 'imageId', 'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256',
                'sourceDescriptorSha256': 'sourceDescriptorSha256'}
    need(rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1' and
         all(rollback.get(left) == plan[right] for left, right in bindings.items()) and
         rollback.get('retainedRuntimeSha') == RETAINED and rollback.get('retainedRunning') is True and
         rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True and
         re.fullmatch(r'[a-f0-9]{64}', rollback.get('retainedContainerId', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', rollback.get('retainedImageId', '')), 'diagnosis_rollback')
    generation_directory = directory / 'generation'
    private_directory(generation_directory)
    generation, generation_raw = diagnosis_json(generation_directory / 'GENERATION.json')
    need(sha(generation_raw) == plan['generationManifestSha256'] and generation.get('generationId') == plan['generationId'] and
         generation.get('runtimeSha') == plan['pricingRuntimeSha'] and generation.get('prepared') is True, 'diagnosis_generation')
    generation_names = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                        'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'}
    files = []
    for descriptor in plan['files']:
        filename = (generation_directory if descriptor['name'] in generation_names else directory) / descriptor['name']
        try:
            info = regular(filename)
        except FileNotFoundError:
            files.append({'name': descriptor['name'], 'present': False, 'bytes': None, 'expectedBytes': descriptor['bytes'],
                          'sizeMatches': False, 'private': False})
            continue
        files.append({'name': descriptor['name'], 'present': True, 'bytes': info.st_size, 'expectedBytes': descriptor['bytes'],
                      'sizeMatches': info.st_size == descriptor['bytes'], 'private': stat.S_IMODE(info.st_mode) == 0o400})
    regular(CONFIG, 1024 * 1024)
    ingress = CONFIG.read_bytes()
    retained = docker('GET', '/containers/' + rollback['retainedContainerId'] + '/json')
    identity = protected_identity(retained)
    env = env_map(retained)
    need(retained.get('Image') == rollback['retainedImageId'] and retained['State']['Running'] is True and
         env.get('AVTOCENA_RELEASE_SHA') == RETAINED and env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
         any(str(binding.get('HostPort', '')) == str(backend(ingress)) for bindings in
             (retained.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings),
         'diagnosis_retained')
    try:
        image = docker('GET', '/images/' + plan['imageId'] + '/json')
        image_result = {'present': True, 'identityMatches': image.get('Id') == plan['imageId'] and image.get('Os') == 'linux' and
                        image.get('Architecture') == 'amd64' and
                        image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == plan['runtimeSha']}
    except ReleaseError as error:
        if str(error) != 'china_host_docker_http_404':
            raise
        image_result = {'present': False, 'identityMatches': False}
    filter_query = urlencode({'filters': json.dumps({'label': ['avtocena.china.nonce=' + plan['nonce']]})})
    containers = docker('GET', '/containers/json?all=1&' + filter_query)
    need(isinstance(containers, list) and len(containers) <= 1, 'diagnosis_candidates')
    candidate = {'present': False, 'running': None, 'status': None, 'exitCode': None, 'oomKilled': None}
    if containers:
        row = docker('GET', '/containers/' + containers[0]['Id'] + '/json')
        labels = row.get('Config', {}).get('Labels', {})
        state = row.get('State', {})
        need(row.get('Image') == plan['imageId'] and labels.get('avtocena.china.nonce') == plan['nonce'] and
             labels.get('org.opencontainers.image.revision') == plan['runtimeSha'] and
             labels.get('avtocena.role') == 'independent-china' and type(state.get('Running')) is bool and
             type(state.get('ExitCode')) is int and type(state.get('OOMKilled')) is bool and
             state.get('Status') in {'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'}, 'diagnosis_candidate')
        candidate = {'present': True, 'running': state['Running'], 'status': state['Status'],
                     'exitCode': state['ExitCode'], 'oomKilled': state['OOMKilled']}
    events = diagnosis_events(plan, since, until)
    startup = saved_startup_diagnosis(directory)
    server_speed = saved_speed_diagnosis(directory, plan)
    need(CONFIG.read_bytes() == ingress and
         protected_identity(docker('GET', '/containers/' + retained['Id'] + '/json')) == identity,
         'diagnosis_retained_changed')
    need(diagnosis_json(directory / 'PLAN.json')[1] == plan_raw and
         diagnosis_json(directory / 'ROLLED_BACK.json')[1] == rollback_raw and not (directory / 'ACCEPTED.json').exists(),
         'diagnosis_changed')
    disk = os.statvfs(BASE)
    free_bytes = disk.f_bavail * disk.f_frsize
    need(type(free_bytes) is int and 0 <= free_bytes <= 9007199254740991, 'diagnosis_disk_capacity')
    return {'version': 1, 'kind': 'china-host-startup-diagnosis-v1', 'readOnly': True, 'selector': dict(params),
            'nonce': plan['nonce'], 'planSha256': sha(plan_raw), 'rollbackSha256': sha(rollback_raw), 'outcome': 'rolled_back',
            'files': files, 'generationVerified': True, 'image': image_result, 'diskFreeBytes': free_bytes,
            'startup': startup, 'serverSpeed': server_speed,
            'retained': {'identityConfirmed': True, 'running': True}, 'candidate': candidate, 'events': events}


def check_mounted_reference(container, reference, nonce, *, require_running=True):
    env = env_map(container)
    running = container.get('State', {}).get('Running')
    need(container.get('Image') == reference['imageId'] and type(running) is bool and (running or not require_running) and
         env.get('AVTOCENA_RELEASE_SHA') == reference['runtimeSha'] and
         env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
         env.get('CATALOG_CHINA_LOCAL_RUNTIME_SHA') == reference['pricingRuntimeSha'] and
         env.get('CATALOG_CHINA_LOCAL_MANIFEST_SHA256') == reference['generationManifestSha256'] and
         env.get('CATALOG_CHINA_LOCAL_GENERATION_DIR') == GENERATION_MOUNT and
         container['Config'].get('Labels', {}).get('avtocena.china.nonce') == nonce, 'mounted_reference')
    mounts = [row for row in container.get('Mounts', []) if row.get('Destination') == GENERATION_MOUNT]
    directory = BASE / reference['runtimeSha'] / 'china-next' / nonce / 'generation'
    need(len(mounts) == 1 and mounts[0].get('Type') == 'bind' and mounts[0].get('RW') is False and
         mounts[0].get('Source') == str(directory), 'mounted_generation')
    return generation_reference(reference, nonce)


def generation_reference(reference, nonce):
    directory = BASE / reference['runtimeSha'] / 'china-next' / nonce / 'generation'
    for parent in (BASE, directory.parent.parent.parent, directory.parent.parent, directory.parent):
        private_directory(parent)
    private_directory(directory)
    filename = directory / 'GENERATION.json'
    regular(filename, 256 * 1024)
    raw = filename.read_bytes()
    need(sha(raw) == reference['generationManifestSha256'], 'mounted_generation_hash')
    generation = json.loads(raw)
    need(generation.get('generationId') == reference['generationId'] and
         generation.get('runtimeSha') == reference['pricingRuntimeSha'] and generation.get('prepared') is True and
         generation.get('source', {}).get('cursor') == reference['sourceCursor'] and
         generation.get('source', {}).get('sourceObservedAt') == reference['sourceObservedAt'], 'mounted_generation_identity')
    return generation


def verify_live_reference(reference, nonce):
    """A historical receipt is not evidence that its cut is still serving."""
    regular(CONFIG, 1024 * 1024)
    ingress = CONFIG.read_bytes()
    port = backend(ingress)
    rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
    serving = [row for row in rows if any(str(binding.get('HostPort', '')) == str(port)
               for bindings in (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings)]
    need(len(serving) == 1, 'serving_container')
    current = serving[0]
    identity = protected_identity(current)
    check_mounted_reference(current, reference, nonce)
    health(port, reference['runtimeSha'])
    need(CONFIG.read_bytes() == ingress and
         protected_identity(docker('GET', '/containers/' + current['Id'] + '/json')) == identity, 'recovery_serving_changed')
    return current


def read_outcome(params, *, verify_current=True):
    """Read only the durable result of one authenticated nonce. No inference
    from elapsed time, a missing receipt, or the current ingress is acceptance."""
    release, nonce = params.get('runtimeSha', ''), params.get('nonce', '')
    need(re.fullmatch(r'[a-f0-9]{40}', release) and re.fullmatch(r'[a-f0-9]{32}', nonce), 'recovery_identity')
    directory = BASE / release / 'china-next' / nonce
    for parent in (BASE, directory.parent.parent, directory.parent, directory):
        private_directory(parent)
    regular(directory / 'PLAN.json', 256 * 1024)
    plan = json.loads((directory / 'PLAN.json').read_bytes())
    validate_plan(plan)
    need(plan['runtimeSha'] == release and plan['nonce'] == nonce, 'recovery_plan')
    accepted, rollback = directory / 'ACCEPTED.json', directory / 'ROLLED_BACK.json'
    need(not (accepted.exists() and rollback.exists()), 'recovery_conflict')
    if accepted.exists():
        regular(accepted, 256 * 1024)
        raw = accepted.read_bytes()
        receipt = json.loads(raw)
        need(receipt.get('release') == release and receipt.get('nonce') == nonce and
             receipt.get('generationManifestSha256') == plan['generationManifestSha256'], 'recovery_receipt')
        reports = []
        for name, field in [('BROWSER_SPEED.json', 'speedReportSha256'), ('BROWSER_DETAILS.json', 'detailsReportSha256')]:
            regular(directory / name, 256 * 1024)
            report = (directory / name).read_bytes()
            need(sha(report) == receipt['browser'].get(field), 'recovery_browser')
            reports.append(report)
        need(sha(b''.join(reports)) == receipt['browser'].get('reportSha256'), 'recovery_browser')
        if code_update(plan):
            previous, _, _ = accepted_predecessor(plan)
            need(receipt.get('transition') == 'code-update' and
                 receipt.get('previousAcceptedETag') == plan['previousAcceptedETag'] and
                 receipt.get('previousAcceptedStateSha256') == plan['previousAcceptedStateSha256'] and
                 receipt.get('retainedRuntimeSha') == previous['runtimeSha'] and
                 receipt.get('retainedImageId') == previous['imageId'], 'recovery_code_receipt')
        if accepted_update(plan) and verify_current:
            need(receipt.get('generationId') == plan['generationId'] and receipt.get('pricingRuntimeSha') == plan['pricingRuntimeSha'] and
                 receipt.get('imageId') == plan['imageId'], 'recovery_receipt')
            verify_live_reference({'runtimeSha': release, 'pricingRuntimeSha': plan['pricingRuntimeSha'],
                'imageId': plan['imageId'], 'generationId': plan['generationId'],
                'generationManifestSha256': plan['generationManifestSha256'],
                'sourceCursor': receipt['sourceCursor'], 'sourceObservedAt': receipt['sourceObservedAt']}, nonce)
        return {'status': 'accepted', 'hostReceiptBase64': base64.b64encode(raw).decode(), 'hostReceiptSha256': sha(raw),
                'browserSpeedBase64': base64.b64encode(reports[0]).decode(),
                'browserDetailsBase64': base64.b64encode(reports[1]).decode()}
    if rollback.exists():
        regular(rollback, 256 * 1024)
        raw = rollback.read_bytes()
        receipt = json.loads(raw)
        need(receipt.get('release') == release and receipt.get('nonce') == nonce and
             receipt.get('generationManifestSha256') == plan['generationManifestSha256'], 'recovery_receipt')
        if accepted_update(plan) and verify_current:
            previous, previous_receipt, _ = accepted_predecessor(plan)
            need(receipt.get('retainedRuntimeSha') == previous['runtimeSha'] and
                 receipt.get('retainedImageId') == previous['imageId'] and
                 receipt.get('previousAcceptedETag') == plan['previousAcceptedETag'] and
                 receipt.get('previousAcceptedStateSha256') == plan['previousAcceptedStateSha256'], 'recovery_rollback')
            verify_live_reference(previous, previous_receipt['nonce'])
        return {'status': 'rolled_back', 'hostRollbackBase64': base64.b64encode(raw).decode(), 'hostRollbackSha256': sha(raw)}
    return {'status': 'pending'}


def checked_observation(observation, *, allow_absent=False):
    need(isinstance(observation, dict) and type(observation.get('found')) is bool, 'retire_observation')
    if not observation['found']:
        need(allow_absent and all(observation.get(key) is None for key in ('value', 'etag', 'sha256')), 'retire_observation')
        return None
    need(isinstance(observation.get('etag'), str) and re.fullmatch(r'"[^"\x00-\x20\x7f]{1,250}"', observation['etag']) and
         isinstance(observation.get('sha256'), str) and re.fullmatch(r'[a-f0-9]{64}', observation['sha256']) and
         isinstance(observation.get('value'), dict) and canonical_sha(observation['value']) == observation['sha256'], 'retire_observation')
    return observation['value']


def checked_accepted_observation(observation):
    state = checked_observation(observation)
    need(state.get('version') == 1 and state.get('kind') == 'china-accepted-state-v1' and state.get('market') == 'china' and
         type(state.get('revision')) is int and state['revision'] > 0 and state.get('pending') is None, 'retire_state')
    receipt, _ = accepted_reference_receipt(state.get('current'))
    commit = state.get('commit')
    need(isinstance(commit, dict) and commit.get('nonce') == receipt['nonce'] and
         commit.get('acceptedAt') == receipt.get('acceptedAt') and
         isinstance(commit.get('intentSha256'), str) and re.fullmatch(r'[a-f0-9]{64}', commit['intentSha256']), 'retire_commit')
    if receipt.get('transition') == 'code-update':
        need(isinstance(state.get('rollback'), dict) and
             state['rollback'].get('generationId') == state['current']['generationId'], 'retire_protected')
    if state.get('rollback') is not None:
        rollback_receipt, _ = accepted_reference_receipt(state['rollback'])
        if state['rollback']['generationId'] == state['current']['generationId']:
            current, rollback = state['current'], state['rollback']
            need(same_generation_data(current, rollback) and current['runtimeSha'] != rollback['runtimeSha'] and
                 current['imageId'] != rollback['imageId'] and receipt['nonce'] != rollback_receipt['nonce'] and
                 receipt.get('transition') == 'code-update' and
                 receipt.get('previousAcceptedETag') == commit.get('previousETag') and
                 receipt.get('previousAcceptedStateSha256') == commit.get('previousStateSha256') and
                 receipt.get('retainedRuntimeSha') == rollback['runtimeSha'] and
                 receipt.get('retainedImageId') == rollback['imageId'], 'retire_protected')
    return state


def checked_publication_view(view, *, committed=False):
    need(isinstance(view, dict), 'retire_view')
    state = checked_accepted_observation(view.get('accepted'))
    intent = checked_observation(view.get('intent'), allow_absent=not committed)
    if intent is None:
        return state, None
    need(intent.get('version') == 1 and intent.get('kind') == 'china-publication-intent-v1' and intent.get('market') == 'china' and
         type(intent.get('revision')) is int and intent['revision'] > 0 and
         re.fullmatch(r'[a-f0-9]{32}', intent.get('nonce', '')) and
         intent.get('status') in (('committed',) if committed else ('committed', 'aborted')), 'retire_intent')
    resolution = intent.get('resolution')
    need(isinstance(resolution, dict) and resolution.get('acceptedETag') == view['accepted']['etag'] and
         resolution.get('acceptedSha256') == view['accepted']['sha256'], 'retire_intent_resolution')
    if intent['status'] == 'committed':
        commit = state['commit']
        original = {**intent, 'status': 'pending', 'resolution': None}
        candidate = {key: value for key, value in state['current'].items() if key != 'proof'}
        prior = intent.get('previous')
        prior_value = checked_observation(prior, allow_absent=True)
        need(resolution.get('kind') == 'accepted' and
             resolution.get('hostReceiptSha256') == state['current']['proof']['hostReceiptSha256'] and
             commit['nonce'] == intent['nonce'] and commit['intentSha256'] == canonical_sha(original) and
             commit.get('previousETag') == prior['etag'] and commit.get('previousStateSha256') == prior['sha256'] and
             candidate == intent.get('candidate') and state.get('rollback') == (prior_value.get('current') if prior_value else None),
             'retire_intent_binding')
        if prior_value and candidate['generationId'] == prior_value['current']['generationId']:
            need(intent.get('transition') == 'code-update', 'retire_code_intent')
        else:
            need(intent.get('transition') is None, 'retire_code_intent')
    else:
        need(resolution.get('kind') in ('never_reserved', 'rolled_back') and
             resolution.get('hostReceiptSha256') is None, 'retire_intent_resolution')
    return state, intent


def reference_plan(reference, receipt):
    directory = BASE / reference['runtimeSha'] / 'china-next' / receipt['nonce']
    for parent in (BASE, directory.parent.parent, directory.parent, directory):
        private_directory(parent)
    regular(directory / 'PLAN.json', 256 * 1024)
    plan = json.loads((directory / 'PLAN.json').read_bytes())
    validate_plan(plan)
    bindings = {'runtimeSha': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha', 'imageId': 'imageId',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'receiptSha256': 'privateGenerationReceiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256'}
    need(plan.get('nonce') == receipt['nonce'] and all(reference[left] == plan.get(right) for left, right in bindings.items()),
         'retire_plan_binding')
    return directory, plan


def verified_history(reference, previous=None):
    receipt, raw = accepted_reference_receipt(reference)
    outcome = read_outcome({'runtimeSha': reference['runtimeSha'], 'nonce': receipt['nonce']}, verify_current=False)
    need(outcome.get('status') == 'accepted' and outcome.get('hostReceiptBase64') == base64.b64encode(raw).decode() and
         outcome.get('hostReceiptSha256') == sha(raw), 'retire_history')
    _, plan = reference_plan(reference, receipt)
    if previous is not None:
        need(accepted_update(plan) and plan.get('previousAcceptedState') == previous['value'] and
             plan.get('previousAcceptedETag') == previous['etag'] and
             plan.get('previousAcceptedStateSha256') == previous['sha256'], 'retire_original_plan')
    return receipt


def same_generation_data(left, right):
    keys = ('market', 'generationId', 'owner', 'receiptSha256', 'sourceDescriptorSha256',
            'generationManifestSha256', 'sourceCursor', 'sourceObservedAt', 'pricingRuntimeSha')
    return all(key in left and key in right and left[key] == right[key] for key in keys)


def deployment_identity(reference):
    receipt, _ = accepted_reference_receipt(reference)
    return reference['runtimeSha'], receipt['nonce']


def code_preflight(params):
    """Read bounded accepted metadata for a code-only release. No generation
    restore, supplier request, directory creation or host write is performed."""
    need(isinstance(params, dict) and set(params) == {'previousAccepted'}, 'code_preflight_parameters')
    state = checked_accepted_observation(params['previousAccepted'])
    reference = state['current']
    lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(lock)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'runtime_lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receipt = verified_history(reference)
        retained = verify_live_reference(reference, receipt['nonce'])
        identity = protected_identity(retained)
        regular(CONFIG, 1024 * 1024)
        ingress = CONFIG.read_bytes()
        directory, plan = reference_plan(reference, receipt)
        plan_sha = file_sha(directory / 'PLAN.json')
        raw_manifest = (directory / 'generation' / 'GENERATION.json').read_bytes()
        need(sha(raw_manifest) == reference['generationManifestSha256'], 'code_manifest_changed')
        regular(directory / 'acceptance.json', 256 * 1024)
        raw_oracle = (directory / 'acceptance.json').read_bytes()
        descriptor = next(row for row in plan['files'] if row['name'] == 'acceptance.json')
        need(len(raw_oracle) == descriptor['bytes'] and sha(raw_oracle) == descriptor['sha256'], 'code_oracle_changed')
        checked_code_oracle(json.loads(raw_oracle), reference)
        need(file_sha(directory / 'PLAN.json') == plan_sha and CONFIG.read_bytes() == ingress and
             protected_identity(docker('GET', '/containers/' + retained['Id'] + '/json')) == identity,
             'code_preflight_changed')
        disk = os.statvfs(BASE)
        generation_files = [row for row in plan['files'] if row['name'] in GENERATION_FILES]
        return {'version': 1, 'kind': 'china-code-preflight-v1', 'runtimeSha': reference['runtimeSha'],
                'generationId': reference['generationId'], 'previousPlanSha256': plan_sha,
                'previousOracleSha256': sha(raw_oracle),
                'generationFiles': generation_files,
                'generationBytes': sum(row['bytes'] for row in generation_files),
                'availableDiskBytes': disk.f_bavail * disk.f_frsize,
                'generationManifestBase64': base64.b64encode(raw_manifest).decode(),
                'acceptanceBase64': base64.b64encode(raw_oracle).decode(),
                'supplierRequests': 0, 'generationWrites': 0}
    finally:
        os.close(lock)


def checked_code_oracle(oracle, reference):
    need(isinstance(oracle, dict) and oracle.get('version') == 1 and
         oracle.get('kind') == 'local-native-reader-http-expectations-v1' and
         oracle.get('runtimeSha') == reference['runtimeSha'] and
         oracle.get('pricingRuntimeSha') == reference['pricingRuntimeSha'] and
         oracle.get('expectedGeneration') == reference['generationId'] and
         oracle.get('generationManifestSha256') == reference['generationManifestSha256'] and
         isinstance(oracle.get('cases'), list) and len(oracle['cases']) >= 8, 'code_oracle_identity')


def collect_local_generation_files(reference, receipt, assert_current):
    directory, plan = reference_plan(reference, receipt)
    generation_reference(reference, receipt['nonce'])
    descriptors = [row for row in plan['files'] if row['name'] in HOST_BULK_FILES]
    plan_sha = file_sha(directory / 'PLAN.json')
    def fence():
        assert_current()
        for parent in (BASE, directory.parent.parent, directory.parent, directory, directory / 'generation'):
            private_directory(parent)
        regular(directory / 'PLAN.json', 256 * 1024)
        need(file_sha(directory / 'PLAN.json') == plan_sha, 'retire_plan_changed')
        rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
        for row in rows:
            for mount in row.get('Mounts', []):
                source = mount.get('Source')
                if not source:
                    continue
                need(isinstance(source, str) and Path(source).is_absolute(), 'retire_mount_path')
                mounted = Path(source).resolve()
                need(mounted != directory and mounted not in directory.parents and directory not in mounted.parents,
                     'retire_files_mounted')
    deleted = freed = 0
    for descriptor in descriptors:
        fence()
        filename = (directory if descriptor['name'] == 'image.tar' else directory / 'generation') / descriptor['name']
        try:
            filename.lstat()
        except FileNotFoundError:
            continue
        before = regular(filename)
        need(before.st_size == descriptor['bytes'] and file_sha(filename) == descriptor['sha256'], 'retire_file_hash')
        fence()
        after = regular(filename)
        need(all(getattr(before, name) == getattr(after, name) for name in
                 ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')), 'retire_file_changed')
        filename.unlink()
        parent_fd = os.open(filename.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        need(not filename.exists(), 'retire_file_still_present')
        deleted += 1
        freed += descriptor['bytes']
    fence()
    # Also make a previous interrupted unlink durable when this attempt found
    # the file already absent (including image.tar in the nonce directory).
    for parent in (directory, directory / 'generation'):
        parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    return {'filesDeleted': deleted, 'freedBytes': freed}


def retire_reference(obsolete, protected_references, protected_ids, assert_current):
    """One immutable task target. Its pinned bulk files are removed only after
    its process and every mount reference are gone; proofs and images remain."""
    assert_current()
    result = {'retiredContainers': 0, 'directoriesDeleted': 0, 'imagesDeleted': 0, 'filesDeleted': 0, 'freedBytes': 0}
    if obsolete is None:
        return {**result, 'reason': 'no_previous_rollback'}
    protected = {deployment_identity(reference) for reference in protected_references if reference}
    need(obsolete.get('market') == 'china' and obsolete.get('runtimeSha') != RETAINED and
         deployment_identity(obsolete) not in protected, 'retire_protected')
    old_receipt = verified_history(obsolete)
    rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
    targets = [row for row in rows if row['Config'].get('Labels', {}).get('avtocena.china.nonce') == old_receipt['nonce']]
    if not targets:
        return {**result, **collect_local_generation_files(obsolete, old_receipt, assert_current), 'reason': 'already_absent'}
    need(len(targets) == 1, 'retire_ambiguous')
    target = targets[0]
    need(target['Id'] not in protected_ids and target['Config'].get('Labels', {}).get('avtocena.application') == 'web' and
         target['Config'].get('Labels', {}).get('avtocena.role') == 'independent-china', 'retire_foreign')
    check_mounted_reference(target, obsolete, old_receipt['nonce'], require_running=False)
    identity = protected_identity(target)
    assert_current()
    need(protected_identity(docker('GET', '/containers/' + target['Id'] + '/json')) == identity, 'retire_target_changed')
    if target['State']['Running']:
        docker('POST', '/containers/' + target['Id'] + '/stop?t=10')
    stopped = docker('GET', '/containers/' + target['Id'] + '/json')
    check_mounted_reference(stopped, obsolete, old_receipt['nonce'], require_running=False)
    # Stop changes process state; Docker may also return the same mount map in
    # another order. Preserve every mount and attribute in the identity fence.
    need(not stopped['State']['Running'] and
         all(stopped[key] == target[key] for key in ('Id', 'Image', 'Config', 'HostConfig')) and
         canonical_mounts(stopped['Mounts']) == canonical_mounts(target['Mounts']),
         'retire_target_changed')
    assert_current()
    docker('DELETE', '/containers/' + target['Id'] + '?v=false&force=false')
    assert_current()
    return {**result, **collect_local_generation_files(obsolete, old_receipt, assert_current),
            'retiredContainers': 1, 'generationId': obsolete['generationId']}


def retire_recovery(params):
    """Authenticated retry of one queued post-commit cleanup. The caller holds
    the China lease and sends fresh pinned accepted/intent observations. This
    function takes the host lock but never initializes a candidate or a nonce
    directory. All eligibility comes from the original committed witness."""
    previous_observation = params.get('previousAccepted')
    previous = checked_accepted_observation(previous_observation)
    original_view = params.get('acceptedPublication')
    original, original_intent = checked_publication_view(original_view, committed=True)
    need(original_intent['previous'] == previous_observation and
         original['revision'] == previous['revision'] + 2 and original.get('rollback') == previous['current'], 'retire_successor')
    fresh, _ = checked_publication_view(params.get('currentState'))
    need(fresh['revision'] >= original['revision'], 'retire_state_older')
    obsolete = previous.get('rollback')
    protected = [fresh['current'], fresh.get('rollback')]
    need(obsolete is None or all(reference is None or deployment_identity(reference) != deployment_identity(obsolete) for reference in protected),
         'retire_protected')
    lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        metadata = os.fstat(lock)
        need(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1, 'runtime_lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verified_history(previous['current'])
        verified_history(original['current'], previous_observation)
        current_receipt = verified_history(fresh['current'])
        current = verify_live_reference(fresh['current'], current_receipt['nonce'])
        ingress = CONFIG.read_bytes()
        guarded = [(current, fresh['current'], current_receipt['nonce'])]
        if fresh.get('rollback') is not None:
            rollback_receipt = verified_history(fresh['rollback'])
            rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
            rollback = [row for row in rows if row['Config'].get('Labels', {}).get('avtocena.china.nonce') == rollback_receipt['nonce']]
            need(len(rollback) == 1 and rollback[0]['Id'] != current['Id'], 'retire_rollback')
            check_mounted_reference(rollback[0], fresh['rollback'], rollback_receipt['nonce'])
            guarded.append((rollback[0], fresh['rollback'], rollback_receipt['nonce']))
        identities = {row['Id']: protected_identity(row) for row, _, _ in guarded}
        def assert_current():
            regular(CONFIG, 1024 * 1024)
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')
            for row, reference, nonce in guarded:
                actual = docker('GET', '/containers/' + row['Id'] + '/json')
                need(protected_identity(actual) == identities[row['Id']], 'retire_protected_changed')
                check_mounted_reference(actual, reference, nonce)
            health(backend(ingress), fresh['current']['runtimeSha'])
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')
        return retire_reference(obsolete, protected, set(identities), assert_current)
    finally:
        os.close(lock)



# This is a separate terminal-image phase. Existing retire/file-cleanup methods
# retain their imagesDeleted == 0 contract, and no legacy pruning entry is called.
APP_IMAGE_RETENTION_POLICY_SHA256 = 'e04ffcae01be1216df266866e4492d723c9f7c0289c597d2639b198d87f32366'


def app_image_references(value, trail=(), depth=0):
    """Keep operational and historical references distinguishable; do not erase
    every image mentioned by a terminal intent or by an encoded receipt."""
    need(depth <= 24, 'app_image_reference_depth')
    found = []
    if isinstance(value, dict):
        for encoded, hashed, name in (
                ('hostReceiptBase64', 'hostReceiptSha256', 'hostReceipt'),
                ('hostRollbackBase64', 'hostRollbackSha256', 'hostRollback')):
            if encoded in value:
                raw, decoded = decode_report(value[encoded])
                need(len(raw) <= 256 * 1024 and sha(raw) == value.get(hashed), 'app_image_reference_hash')
                found.extend(app_image_references(decoded, trail + (name,), depth + 1))
        for key, child in value.items():
            if key in ('imageId', 'retainedImageId'):
                need(isinstance(child, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', child), 'app_image_reference')
                found.append((trail + (key,), child))
            elif isinstance(child, (dict, list)):
                found.extend(app_image_references(child, trail + (key,), depth + 1))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(app_image_references(child, trail + (str(index),), depth + 1))
    return found


class TerminalAppImageCleanup:
    """One image authorized by a resolved committed/rolled-back publication.
    Prepare/remove share both host locks; the controller refreshes its private
    authority between calls. No caller-supplied image target is accepted."""

    def __init__(self, params):
        self.locks, self.proofs = [], []
        self.finished = self.inflight = False
        self.terminal = None
        self.target = self.target_directory = self.target_nonce = None
        try:
            need(isinstance(params, dict) and set(params) == {'action', 'publication', 'currentState',
                 'policySource', 'policySourceSha256'} and params['action'] == 'prepare', 'app_image_prepare')
            self.publication = copy.deepcopy(params['publication'])
            self.witness_sha = canonical_sha(self.publication)
            state, intent = self.authority(params)
            source = params['policySource']
            need(isinstance(source, str) and 0 < len(source.encode()) <= 64 * 1024 and
                 params['policySourceSha256'] == sha(source.encode()) == APP_IMAGE_RETENTION_POLICY_SHA256,
                 'app_image_policy')
            # The immutable reviewed module's __main__ entry never executes.
            policy = importlib.util.module_from_spec(importlib.util.spec_from_loader('app_image_pins', loader=None))
            exec(compile(source, '<reviewed-retention-pins>', 'exec'), policy.__dict__)
            need(callable(getattr(policy, 'pinned_image', None)), 'app_image_policy')
            self.policy = policy
            for name in ('avtocena-staging-prepare', 'avtocena-runtime-change'):
                fd = os.open('/run/lock/' + name + '.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
                self.locks.append(fd)
                info = os.fstat(fd)
                need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'app_image_lock')
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.state, self.intent = state, intent
            self.before = self.free()
            self.select_target()
            if self.target is None:
                self.terminal = self.result('not_applicable', 'no_terminal_image')
                return
            self.pin_protected()
            self.containers_before = self.containers()
            self.container_hashes = {key: protected_identity(row) for key, row in self.containers_before.items()}
            self.images_before = self.images()
            self.ingress = CONFIG.read_bytes()
            self.assert_protected()
            protected_ids = {reference['imageId'] for reference in (state['current'], state.get('rollback')) if reference}
            if self.target['imageId'] in protected_ids:
                self.terminal = self.result('protected', 'current_or_rollback')
                return
            if self.target['runtimeSha'] == RETAINED:
                self.terminal = self.result('protected', 'retained_bootstrap')
                return
            if any(row.get('Image') == self.target['imageId'] for row in self.containers_before.values()):
                self.terminal = self.result('protected', 'container_reference')
                return
            self.check_references()
            self.require_retired_files()
            image = self.inspect_target()
            if image is None:
                need(self.target['imageId'] not in self.images_before, 'app_image_absence')
                self.terminal = self.result('already_absent', 'already_absent')
                return
            need(isinstance(image, dict) and image.get('Id') == self.target['imageId'] and
                 self.target['imageId'] in self.images_before, 'app_image_image_identity')
            if self.policy.pinned_image(image):
                self.terminal = self.result('protected', 'pinned_image')
                return
            if not self.eligible_image(image):
                self.terminal = self.result('protected', 'ineligible_image')
                return
            self.validate_image(image)
            self.image_hash = canonical_sha(image)
            self.fence()
        except BaseException:
            self.close()
            raise

    def authority(self, params):
        need(params.get('publication') == self.publication and params.get('currentState') == self.publication,
             'app_image_authority_changed')
        # The private lease is fenced by the controller, not pinned here: its
        # own successful renewals must not invalidate an accepted/intent fence.
        return checked_publication_view(params['currentState'])

    def pin(self, filename):
        regular(filename, 256 * 1024)
        raw = filename.read_bytes()
        need(len(raw) <= 256 * 1024, 'app_image_proof_size')
        value = json.loads(raw)
        need(isinstance(value, dict), 'app_image_proof')
        self.proofs.append((filename, sha(raw)))
        return value, raw

    def select_target(self):
        state, intent = self.state, self.intent
        if intent is None:
            return
        if intent['status'] == 'committed':
            previous = checked_accepted_observation(intent['previous'])
            need(state['revision'] == previous['revision'] + 2 and state.get('rollback') == previous['current'],
                 'app_image_successor')
            target = previous.get('rollback')
            if target is None:
                return
            # This exact predecessor is the same target as retire_reference.
            receipt = verified_history(target)
            directory, _ = reference_plan(target, receipt)
            self.target = {'runtimeSha': target['runtimeSha'], 'imageId': target['imageId']}
            self.target_nonce, self.target_directory = receipt['nonce'], directory
            self.target_plan, _ = self.pin(directory / 'PLAN.json')
            self.pin(directory / 'ACCEPTED.json')
            generation_reference(target, receipt['nonce'])
            self.pin(directory / 'generation' / 'GENERATION.json')
            verified_history(state['current'], intent['previous'])
            self.mode = 'retired_predecessor'
            return
        if intent.get('transition') != 'code-update' or intent.get('resolution', {}).get('kind') != 'rolled_back':
            return
        previous = checked_accepted_observation(intent['previous'])
        need(state == {**previous, 'revision': previous['revision'] + 2, 'pending': None},
             'app_image_rollback_state')
        candidate = intent.get('candidate')
        need(isinstance(candidate, dict) and re.fullmatch(r'[a-f0-9]{40}', candidate.get('runtimeSha', '')) and
             re.fullmatch(r'sha256:[a-f0-9]{64}', candidate.get('imageId', '')) and
             same_generation_data(candidate, previous['current']), 'app_image_candidate')
        directory = BASE / candidate['runtimeSha'] / 'china-next' / intent['nonce']
        for parent in (BASE, directory.parent.parent, directory.parent, directory, directory / 'generation'):
            private_directory(parent)
        plan, plan_raw = self.pin(directory / 'PLAN.json')
        validate_plan(plan)
        need(code_update(plan) and plan.get('runtimeSha') == candidate['runtimeSha'] and
             plan.get('imageId') == candidate['imageId'] and plan.get('nonce') == intent['nonce'] and
             plan.get('previousAcceptedState') == previous and
             plan.get('previousAcceptedETag') == intent['previous']['etag'] and
             plan.get('previousAcceptedStateSha256') == intent['previous']['sha256'] and
             all(plan.get(key) == candidate[key] for key in
                 ('pricingRuntimeSha', 'generationId', 'generationManifestSha256', 'sourceDescriptorSha256')) and
             plan.get('privateGenerationReceiptSha256') == candidate['receiptSha256'], 'app_image_failed_plan')
        self.require_absent(directory / 'ACCEPTED.json', 'app_image_failed_accepted')
        outcome = read_outcome({'runtimeSha': candidate['runtimeSha'], 'nonce': intent['nonce']}, verify_current=False)
        proof = intent['resolution'].get('rollbackProof')
        need(outcome.get('status') == 'rolled_back' and isinstance(proof, dict) and
             outcome.get('hostRollbackBase64') == proof.get('hostRollbackBase64') and
             outcome.get('hostRollbackSha256') == proof.get('hostRollbackSha256'), 'app_image_rollback_proof')
        rollback, rollback_raw = self.pin(directory / 'ROLLED_BACK.json')
        cleanup, _ = self.pin(directory / 'FAILED_CODE_CLEANUP.json')
        need(sha(rollback_raw) == proof['hostRollbackSha256'] and
             rollback.get('retainedRuntimeSha') == previous['current']['runtimeSha'] and
             rollback.get('retainedImageId') == previous['current']['imageId'] and
             all(rollback.get(key) is True for key in ('retainedRunning', 'candidateRemoved', 'ingressRestored')),
             'app_image_rollback_proof')
        need(cleanup.get('version') == 1 and cleanup.get('kind') == 'china-failed-code-bulk-cleanup-v1' and
             cleanup.get('runtimeSha') == candidate['runtimeSha'] and cleanup.get('nonce') == intent['nonce'] and
             cleanup.get('planSha256') == sha(plan_raw) and cleanup.get('rollbackSha256') == sha(rollback_raw) and
             cleanup.get('completed') is True and cleanup.get('protectedDeploymentsPreserved') is True and
             type(cleanup.get('imagesDeleted')) is int and cleanup['imagesDeleted'] == 0 and
             type(cleanup.get('directoriesDeleted')) is int and cleanup['directoriesDeleted'] == 0,
             'app_image_bulk_cleanup')
        self.target = {'runtimeSha': candidate['runtimeSha'], 'imageId': candidate['imageId']}
        self.target_nonce, self.target_directory, self.target_plan = intent['nonce'], directory, plan
        self.mode = 'confirmed_rollback'

    def pin_protected(self):
        self.protected = []
        for reference in (self.state['current'], self.state.get('rollback')):
            if reference is None:
                continue
            receipt = verified_history(reference)
            directory, _ = reference_plan(reference, receipt)
            generation_reference(reference, receipt['nonce'])
            for name in ('PLAN.json', 'ACCEPTED.json'):
                self.pin(directory / name)
            self.pin(directory / 'generation' / 'GENERATION.json')
            self.protected.append((reference, receipt['nonce']))

    @staticmethod
    def require_absent(filename, code):
        try:
            filename.lstat()
        except FileNotFoundError:
            return
        need(False, code)

    def require_retired_files(self):
        # A stopped or foreign container is an absolute image reference; no
        # container/file is removed by this phase, even when an old bulk remains.
        need(not any(row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') == self.target_nonce
                     for row in self.containers().values()), 'app_image_retirement_incomplete')
        for descriptor in self.target_plan['files']:
            if descriptor['name'] in HOST_BULK_FILES:
                filename = (self.target_directory if descriptor['name'] == 'image.tar'
                            else self.target_directory / 'generation') / descriptor['name']
                self.require_absent(filename, 'app_image_retirement_incomplete')
        if self.mode == 'confirmed_rollback':
            self.require_absent(self.target_directory / 'ACCEPTED.json', 'app_image_failed_accepted')

    def check_references(self):
        for trail, image in app_image_references(self.publication):
            if image != self.target['imageId']:
                continue
            if self.mode == 'retired_predecessor':
                allowed = trail[:5] == ('intent', 'value', 'previous', 'value', 'rollback') or trail in (
                    ('accepted', 'value', 'rollback', 'proof', 'hostReceipt', 'retainedImageId'),
                    ('intent', 'value', 'previous', 'value', 'current', 'proof', 'hostReceipt', 'retainedImageId'))
            else:
                allowed = trail == ('intent', 'value', 'candidate', 'imageId') or trail == (
                    'intent', 'value', 'resolution', 'rollbackProof', 'hostRollback', 'imageId')
            need(allowed, 'app_image_other_reference')

    @staticmethod
    def free():
        usage = os.statvfs(BASE)
        return usage.f_bavail * usage.f_frsize

    @staticmethod
    def containers():
        rows = docker('GET', '/containers/json?all=1')
        need(isinstance(rows, list), 'app_image_containers')
        result = {}
        for item in rows:
            need(isinstance(item, dict) and isinstance(item.get('Id'), str) and
                 re.fullmatch(r'[a-f0-9]{64}', item['Id']) and item['Id'] not in result, 'app_image_container_identity')
            row = docker('GET', '/containers/' + item['Id'] + '/json')
            need(row.get('Id') == item['Id'] and isinstance(row.get('Image'), str) and
                 re.fullmatch(r'sha256:[a-f0-9]{64}', row['Image']), 'app_image_container_identity')
            result[item['Id']] = row
        return result

    @staticmethod
    def images():
        rows = docker('GET', '/images/json?all=1')
        need(isinstance(rows, list), 'app_image_images')
        ids = [row.get('Id') for row in rows if isinstance(row, dict)]
        need(len(ids) == len(rows) and all(isinstance(value, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', value)
             for value in ids) and len(set(ids)) == len(ids), 'app_image_image_identity')
        return set(ids)

    def inspect_target(self):
        try:
            return docker('GET', '/images/' + self.target['imageId'] + '/json')
        except ReleaseError as error:
            if str(error) == 'china_host_docker_http_404':
                return None
            raise

    def eligible_image(self, image):
        config = image.get('Config')
        labels = config.get('Labels') if isinstance(config, dict) else None
        if not isinstance(labels, dict):
            return False
        tags, digests = image.get('RepoTags') or [], image.get('RepoDigests') or []
        return (image.get('Os') == 'linux' and image.get('Architecture') == 'amd64' and
                labels.get('org.opencontainers.image.revision') == self.target['runtimeSha'] and
                labels.get('org.opencontainers.image.source') == 'https://github.com/jeep-jim/AvtoCena' and
                labels.get('avtocena.application') == 'web' and
                isinstance(tags, list) and len(tags) == 1 and isinstance(tags[0], str) and
                re.fullmatch(r'avtocena-china-runtime:' + self.target['runtimeSha'] + r'-[a-f0-9]{12}', tags[0]) is not None and
                digests == ['avtocena-china-runtime@' + self.target['imageId']])

    def validate_image(self, image):
        need(image.get('Id') == self.target['imageId'] and self.eligible_image(image), 'app_image_owner')
        need(not self.policy.pinned_image(image), 'app_image_pinned')

    def assert_protected(self):
        need(CONFIG.read_bytes() == self.ingress, 'app_image_ingress_changed')
        for reference, nonce in self.protected:
            rows = [row for row in self.containers().values()
                    if row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') == nonce]
            need(len(rows) == 1, 'app_image_protected_container')
            check_mounted_reference(rows[0], reference, nonce)
        verify_live_reference(self.state['current'], self.protected[0][1])
        for filename, digest in self.proofs:
            regular(filename, 256 * 1024)
            need(file_sha(filename) == digest, 'app_image_proof_changed')

    def fence(self, *, removed=False):
        self.assert_protected()
        rows = self.containers()
        need({key: protected_identity(row) for key, row in rows.items()} == self.container_hashes,
             'app_image_container_changed')
        expected = self.images_before - ({self.target['imageId']} if removed else set())
        need(self.images() == expected, 'app_image_image_set_changed')
        self.check_references()
        self.require_retired_files()
        image = self.inspect_target()
        if removed:
            need(image is None, 'app_image_delete_not_confirmed')
        else:
            need(image is not None and canonical_sha(image) == self.image_hash, 'app_image_changed')
            self.validate_image(image)
        return rows

    def result(self, status, reason):
        after = self.free()
        self.finished = True
        return {'version': 1, 'kind': 'china-terminal-app-image-cleanup-v1', 'completed': True,
                'status': status, 'uncertain': False, 'imagesRemoved': 1 if status == 'removed' else 0,
                'runtimeSha': self.target['runtimeSha'] if self.target else None,
                'imageId': self.target['imageId'] if self.target else None,
                'witnessSha256': self.witness_sha, 'diskFreeBytesBefore': self.before, 'diskFreeBytesAfter': after,
                'measuredFreeBytesChange': after - self.before, 'reason': reason}

    def prepared(self):
        if self.terminal is not None:
            return self.terminal
        return {'version': 1, 'kind': 'china-terminal-app-image-prepared-v1',
                **self.target, 'witnessSha256': self.witness_sha}

    def remove(self, params):
        need(not self.finished and isinstance(params, dict) and set(params) == {'action', 'publication', 'currentState'}
             and params['action'] == 'remove', 'app_image_sequence')
        self.authority(params)
        self.fence()
        self.before = self.free()
        self.inflight = True
        result = docker('DELETE', '/images/' + self.target['imageId'] + '?force=false&noprune=true')
        need(isinstance(result, list), 'app_image_delete_reply')
        self.fence(removed=True)
        self.inflight = False
        return self.result('removed', 'exact_terminal_image')

    def pending(self):
        return {'version': 1, 'kind': 'china-terminal-app-image-cleanup-v1', 'completed': False,
                'status': 'pending', 'uncertain': self.inflight,
                'errorCode': 'delete_not_confirmed' if self.inflight else 'proof_invalid'}

    def close(self):
        for fd in reversed(self.locks):
            os.close(fd)
        self.locks = []


def reuse_lock():
    lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(lock)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'runtime_lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return lock
    except BaseException:
        os.close(lock)
        raise


def prune_failed_uploads(params):
    """Remove eight old failed-upload files before first China acceptance.

    The newer, fully hashed failed upload remains a protected local witness.
    The same generation stays in REG; no proof, image, directory, publication
    state, ingress or container is changed. Missing old files are resumable.
    """
    need(isinstance(params, dict) and set(params) == {'publicationState', 'leaseExpiresAt'}, 'prune_parameters')
    view = params['publicationState']
    need(isinstance(view, dict) and set(view) == {'accepted', 'intent'}, 'prune_unaccepted_state')
    for observation in view.values():
        need(isinstance(observation, dict) and set(observation) == {'found', 'etag', 'sha256', 'value'}
             and observation['found'] is False and all(observation[key] is None for key in ('etag', 'sha256', 'value')),
             'prune_unaccepted_state')
    expiry = params.get('leaseExpiresAt')
    need(isinstance(expiry, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', expiry), 'prune_lease')
    deadline = datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00')).timestamp()
    need(time.time() < deadline <= time.time() + 2 * 60 * 60, 'prune_lease')
    lock = reuse_lock()
    try:
        witness = FAILED_UPLOAD_WITNESS
        witness_directory = BASE / witness['runtimeSha'] / 'china-next' / witness['nonce']
        def check_directories(directory):
            for parent in (BASE, directory.parent.parent, directory.parent, directory, directory / 'generation'):
                private_directory(parent)
        check_directories(witness_directory)
        witness_plan, witness_plan_raw = diagnosis_json(witness_directory / 'PLAN.json')
        witness_rollback, witness_rollback_raw = diagnosis_json(witness_directory / 'ROLLED_BACK.json')
        need(sha(witness_plan_raw) == witness['planSha256'] and sha(witness_rollback_raw) == witness['rollbackSha256'],
             'prune_witness_proof')
        validate_plan(witness_plan)
        need(not generation_update(witness_plan)
             and all(witness_plan[key] == value for key, value in witness.items() if key not in ('planSha256', 'rollbackSha256'))
             and witness_plan.get('previousAcceptedETag') is None and witness_plan.get('previousAcceptedStateSha256') is None,
             'prune_witness_plan')
        bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha',
                    'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                    'imageId': 'imageId', 'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256',
                    'sourceDescriptorSha256': 'sourceDescriptorSha256'}
        def checked_rollback(rollback, plan):
            need(rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1'
                 and all(rollback.get(left) == plan[right] for left, right in bindings.items())
                 and rollback.get('retainedRuntimeSha') == RETAINED and rollback.get('retainedRunning') is True
                 and rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True
                 and re.fullmatch(r'[a-f0-9]{64}', rollback.get('retainedContainerId', ''))
                 and re.fullmatch(r'sha256:[a-f0-9]{64}', rollback.get('retainedImageId', '')), 'prune_rollback')
        checked_rollback(witness_rollback, witness_plan)
        regular(CONFIG, 1024 * 1024)
        ingress = CONFIG.read_bytes()
        retained = docker('GET', '/containers/' + witness_rollback['retainedContainerId'] + '/json')
        retained_env = env_map(retained)
        need(retained['Image'] == witness_rollback['retainedImageId'] and retained['State']['Running'] is True
             and retained_env.get('AVTOCENA_RELEASE_SHA') == RETAINED
             and retained_env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION
             and any(str(binding.get('HostPort', '')) == str(backend(ingress)) for ports in
                     (retained.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in ports), 'prune_retained')
        retained_identity = protected_identity(retained)
        generation_names = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                            'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'}
        witness_files = {}
        for descriptor in witness_plan['files']:
            filename = (witness_directory / 'generation' if descriptor['name'] in generation_names else witness_directory) / descriptor['name']
            identity = reuse_file_identity(filename)
            need(identity[2] == descriptor['bytes'], 'prune_witness_size')
            witness_files[filename] = (identity, descriptor)
        witness_proofs = {witness_directory / name: reuse_file_identity(witness_directory / name)
                          for name in ('PLAN.json', 'ROLLED_BACK.json')}
        targets = []
        for target in FAILED_UPLOAD_TARGETS:
            directory = BASE / FAILED_UPLOAD_RUNTIME / 'china-next' / target['nonce']
            check_directories(directory)
            plan, plan_raw = diagnosis_json(directory / 'PLAN.json')
            rollback, rollback_raw = diagnosis_json(directory / 'ROLLED_BACK.json')
            need(sha(plan_raw) == target['planSha256'] and sha(rollback_raw) == target['rollbackSha256'], 'prune_proof_hash')
            validate_plan(plan)
            need(not generation_update(plan) and plan['runtimeSha'] == FAILED_UPLOAD_RUNTIME
                 and plan['nonce'] == target['nonce'] and plan['generationId'] == FAILED_UPLOAD_GENERATION
                 and all(plan[key] == witness_plan[key] for key in ('generationManifestSha256', 'privateGenerationReceiptSha256',
                                                                    'pricingRuntimeSha', 'sourceDescriptorSha256')),
                 'prune_plan')
            checked_rollback(rollback, plan)
            need(rollback['retainedContainerId'] == retained['Id'] and rollback['retainedImageId'] == retained['Image'], 'prune_rollback')
            descriptors = {row['name']: row for row in plan['files'] if row['name'] in FAILED_UPLOAD_BULK_FILES}
            need(set(descriptors) == set(FAILED_UPLOAD_BULK_FILES), 'prune_files')
            proofs = {directory / name: reuse_file_identity(directory / name) for name in ('PLAN.json', 'ROLLED_BACK.json')}
            targets.append((directory, target, plan_raw, rollback_raw, descriptors, proofs))
        pending, absent_paths = {}, set()
        for directory, _, _, _, descriptors, _ in targets:
            for name in FAILED_UPLOAD_BULK_FILES:
                filename = (directory if name == 'image.tar' else directory / 'generation') / name
                try:
                    identity = reuse_file_identity(filename)
                except FileNotFoundError:
                    absent_paths.add(filename)
                    continue
                need(identity[2] == descriptors[name]['bytes'], 'prune_file_hash')
                pending[filename] = (identity, descriptors[name])
        absent = len(absent_paths)

        def fence():
            need(time.time() < deadline, 'prune_lease_expired')
            regular(CONFIG, 1024 * 1024)
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')
            need(protected_identity(docker('GET', '/containers/' + retained['Id'] + '/json')) == retained_identity,
                 'prune_protected_changed')
            health(backend(ingress), RETAINED)
            check_directories(witness_directory)
            need(not os.path.lexists(witness_directory / 'ACCEPTED.json')
                 and not os.path.lexists(witness_directory / 'ACCEPTED.pending'), 'prune_witness_accepted')
            need(diagnosis_json(witness_directory / 'PLAN.json')[1] == witness_plan_raw
                 and diagnosis_json(witness_directory / 'ROLLED_BACK.json')[1] == witness_rollback_raw, 'prune_witness_proof')
            for filename, identity in witness_proofs.items():
                need(reuse_file_identity(filename) == identity, 'prune_witness_changed')
            for filename, (identity, _) in witness_files.items():
                need(reuse_file_identity(filename) == identity, 'prune_witness_changed')
            image = docker('GET', '/images/' + witness['imageId'] + '/json')
            need(image.get('Id') == witness['imageId'] and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64'
                 and image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == witness['runtimeSha'],
                 'prune_witness_image')
            for directory, _, plan_raw, rollback_raw, _, proofs in targets:
                check_directories(directory)
                need(diagnosis_json(directory / 'PLAN.json')[1] == plan_raw
                     and diagnosis_json(directory / 'ROLLED_BACK.json')[1] == rollback_raw, 'prune_proof_changed')
                for filename, identity in proofs.items():
                    need(reuse_file_identity(filename) == identity, 'prune_proof_changed')
                need(not os.path.lexists(directory / 'ACCEPTED.json') and not os.path.lexists(directory / 'ACCEPTED.pending'),
                     'prune_accepted_target')
            for filename, (identity, _) in pending.items():
                need(reuse_file_identity(filename) == identity, 'prune_file_changed')
            need(all(not os.path.lexists(filename) for filename in absent_paths), 'prune_file_appeared')
            rows = docker('GET', '/containers/json?all=1')
            need(isinstance(rows, list) and len(rows) <= 1024, 'prune_containers')
            scopes = [witness_directory, *(directory for directory, *_ in targets)]
            nonces = {witness['nonce'], *(target['nonce'] for target in FAILED_UPLOAD_TARGETS)}
            for item in rows:
                row = docker('GET', '/containers/' + item['Id'] + '/json')
                need(row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') not in nonces, 'prune_candidate_exists')
                for mount in row.get('Mounts', []):
                    source = mount.get('Source')
                    if not source:
                        continue
                    need(isinstance(source, str) and Path(source).is_absolute(), 'prune_mount_path')
                    mounted = Path(source).resolve()
                    need(all(mounted != directory and mounted not in directory.parents and directory not in mounted.parents
                             for directory in scopes), 'prune_files_mounted')
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')

        # One complete hash pass over the protected witness and every remaining
        # target precedes deletion. Later fences compare identities and proofs;
        # they do not rehash these bulk files before each of the eight unlinks.
        fence()
        for files, code in ((witness_files, 'prune_witness_hash'), (pending, 'prune_file_hash')):
            for filename, (identity, descriptor) in files.items():
                fence()
                need(file_sha(filename) == descriptor['sha256'] and reuse_file_identity(filename) == identity, code)
        fence()
        deleted = freed = 0
        for filename in list(pending):
            fence()
            identity, descriptor = pending[filename]
            need(reuse_file_identity(filename) == identity, 'prune_file_changed')
            filename.unlink()
            directory_fd = os.open(filename.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            need(not os.path.lexists(filename), 'prune_file_still_present')
            del pending[filename]
            absent_paths.add(filename)
            deleted += 1
            freed += descriptor['bytes']
        # Also make an interrupted prior unlink durable on a resumed run.
        for directory, *_ in targets:
            for folder in (directory, directory / 'generation'):
                directory_fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        fence()
        return {'version': 2, 'kind': 'china-failed-upload-prune-v2', 'phase': 'before-first-acceptance', 'completed': True,
                'liveRuntimeSha': RETAINED, 'protectedFailedAttempt': dict(witness), 'protectedFilesVerified': len(witness_files),
                'targetRuntimeSha': FAILED_UPLOAD_RUNTIME, 'targetNonces': [target['nonce'] for target in FAILED_UPLOAD_TARGETS],
                'filesDeleted': deleted, 'freedBytes': freed, 'alreadyAbsentFiles': absent,
                'retiredContainers': 0, 'imagesDeleted': 0, 'directoriesDeleted': 0,
                'privateGenerationDeletes': 0, 'acceptedStateWrites': 0, 'intentStateWrites': 0}
    finally:
        os.close(lock)


def prune_failed_witness(params):
    """Retire one of three fixed failed bulk copies after exact acceptance.

    Earlier 822 bulk copies must already be absent. All small proofs, the live
    accepted generation, retained 56, images and REG objects are preserved.
    """
    need(isinstance(params, dict) and set(params) == {'currentState', 'leaseExpiresAt', 'targetIndex'}, 'witness_parameters')
    target_index = params['targetIndex']
    need(type(target_index) is int and target_index in (0, 1, 2), 'witness_target')
    expiry = params.get('leaseExpiresAt')
    need(isinstance(expiry, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', expiry), 'witness_lease')
    deadline = datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00')).timestamp()
    need(time.time() < deadline <= time.time() + 2 * 60 * 60, 'witness_lease')
    state, _ = checked_publication_view(params['currentState'], committed=True)
    reference, target = state['current'], FAILED_WITNESS_TARGETS[target_index]
    need(reference['runtimeSha'] == FAILED_WITNESS_ACCEPTED_RUNTIME and state.get('rollback') is None
         and reference['generationId'] == target['generationId']
         and reference['pricingRuntimeSha'] == target['pricingRuntimeSha']
         and reference['generationManifestSha256'] == target['generationManifestSha256']
         and reference['receiptSha256'] == target['privateGenerationReceiptSha256'], 'witness_current')
    lock = reuse_lock()
    try:
        accepted_receipt = verified_history(reference)
        current = verify_live_reference(reference, accepted_receipt['nonce'])
        current_directory, current_plan = reference_plan(reference, accepted_receipt)
        need(not generation_update(current_plan), 'witness_first_acceptance')
        retained = docker('GET', '/containers/' + accepted_receipt['retainedContainerId'] + '/json')
        retained_env = env_map(retained)
        need(retained['Id'] != current['Id'] and retained['State']['Running'] is True
             and retained_env.get('AVTOCENA_RELEASE_SHA') == RETAINED
             and retained_env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION, 'witness_retained')
        ingress = CONFIG.read_bytes()
        protected = {row['Id']: protected_identity(row) for row in (current, retained)}
        generation_names = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                            'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'}
        def check_directories(directory):
            for parent in (BASE, directory.parent.parent, directory.parent, directory, directory / 'generation'):
                private_directory(parent)
        def location(directory, name):
            return (directory / 'generation' if name in generation_names else directory) / name
        def disk_free_bytes():
            disk = os.statvfs(BASE)
            available = disk.f_bavail * disk.f_frsize
            need(type(available) is int and 0 <= available <= 9007199254740991, 'witness_disk_capacity')
            return available
        check_directories(current_directory)
        protected_files = {}
        for descriptor in current_plan['files']:
            filename = location(current_directory, descriptor['name'])
            identity = reuse_file_identity(filename)
            need(identity[2] == descriptor['bytes'], 'witness_current_file')
            protected_files[filename] = identity
        for name in ('PLAN.json', 'ACCEPTED.json', 'BROWSER_SPEED.json', 'BROWSER_DETAILS.json'):
            filename = current_directory / name
            protected_files[filename] = reuse_file_identity(filename)

        directory = BASE / target['runtimeSha'] / 'china-next' / target['nonce']
        need(directory != current_directory and directory not in current_directory.parents
             and current_directory not in directory.parents and target['nonce'] != accepted_receipt['nonce'],
             'witness_current_alias')
        check_directories(directory)
        plan, plan_raw = diagnosis_json(directory / 'PLAN.json')
        rollback, rollback_raw = diagnosis_json(directory / 'ROLLED_BACK.json')
        need(sha(plan_raw) == target['planSha256'] and sha(rollback_raw) == target['rollbackSha256'], 'witness_proof')
        validate_plan(plan)
        need(not generation_update(plan)
             and all(plan[key] == value for key, value in target.items() if key not in ('planSha256', 'rollbackSha256'))
             and plan['sourceDescriptorSha256'] == reference['sourceDescriptorSha256'], 'witness_plan')
        bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha',
                    'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                    'imageId': 'imageId', 'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256',
                    'sourceDescriptorSha256': 'sourceDescriptorSha256'}
        need(rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1'
             and all(rollback.get(left) == plan[right] for left, right in bindings.items())
             and rollback.get('retainedRuntimeSha') == RETAINED and rollback.get('retainedRunning') is True
             and rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True
             and rollback.get('retainedContainerId') == retained['Id']
             and rollback.get('retainedImageId') == retained['Image'], 'witness_rollback')
        proof_identities = {directory / name: reuse_file_identity(directory / name) for name in ('PLAN.json', 'ROLLED_BACK.json')}
        descriptors = {row['name']: row for row in plan['files'] if row['name'] in FAILED_UPLOAD_BULK_FILES}
        need(set(descriptors) == set(FAILED_UPLOAD_BULK_FILES)
             and sum(row['bytes'] for row in descriptors.values()) == FAILED_WITNESS_BULK_BYTES[target_index], 'witness_files')
        earlier = []
        for old in FAILED_UPLOAD_TARGETS:
            old_directory = BASE / FAILED_UPLOAD_RUNTIME / 'china-next' / old['nonce']
            check_directories(old_directory)
            old_proofs = {}
            for name, expected in (('PLAN.json', old['planSha256']), ('ROLLED_BACK.json', old['rollbackSha256'])):
                filename = old_directory / name
                _, raw = diagnosis_json(filename)
                need(sha(raw) == expected, 'witness_earlier_proof')
                old_proofs[filename] = (reuse_file_identity(filename), raw)
            earlier.append((old_directory, old_proofs))
        pending, absent_paths = {}, set()
        for name, descriptor in descriptors.items():
            filename = location(directory, name)
            try:
                identity = reuse_file_identity(filename)
            except FileNotFoundError:
                absent_paths.add(filename)
                continue
            need(identity[2] == descriptor['bytes'], 'witness_file_hash')
            pending[filename] = (identity, descriptor)
        absent = len(absent_paths)

        scopes = [directory, *(old_directory for old_directory, _ in earlier)]
        # A Docker bind source may name an alias of a target, a bulk file or
        # any ancestor (including above BASE). Resolved paths alone cannot
        # establish that those inodes are unmounted.
        mount_directories = {}
        for scope in scopes:
            for folder in (scope, scope / 'generation', *scope.parents):
                info = folder.stat()
                mount_directories[folder] = (info.st_dev, info.st_ino)

        def fence():
            need(time.time() < deadline, 'witness_lease_expired')
            regular(CONFIG, 1024 * 1024)
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')
            for identity, expected in protected.items():
                need(protected_identity(docker('GET', '/containers/' + identity + '/json')) == expected, 'witness_protected_changed')
            need(verified_history(reference) == accepted_receipt, 'witness_acceptance_changed')
            check_mounted_reference(docker('GET', '/containers/' + current['Id'] + '/json'), reference, accepted_receipt['nonce'])
            health(backend(ingress), reference['runtimeSha'])
            check_directories(current_directory)
            for filename, identity in protected_files.items():
                need(reuse_file_identity(filename) == identity, 'witness_current_changed')
            check_directories(directory)
            need(not os.path.lexists(directory / 'ACCEPTED.json') and not os.path.lexists(directory / 'ACCEPTED.pending'),
                 'witness_target_accepted')
            need(diagnosis_json(directory / 'PLAN.json')[1] == plan_raw
                 and diagnosis_json(directory / 'ROLLED_BACK.json')[1] == rollback_raw, 'witness_proof_changed')
            for filename, identity in proof_identities.items():
                need(reuse_file_identity(filename) == identity, 'witness_proof_changed')
            for old_directory, old_proofs in earlier:
                check_directories(old_directory)
                need(not os.path.lexists(old_directory / 'ACCEPTED.json') and not os.path.lexists(old_directory / 'ACCEPTED.pending'),
                     'witness_earlier_accepted')
                for filename, (identity, raw) in old_proofs.items():
                    need(reuse_file_identity(filename) == identity and diagnosis_json(filename)[1] == raw, 'witness_earlier_proof')
                need(all(not os.path.lexists(location(old_directory, name)) for name in FAILED_UPLOAD_BULK_FILES),
                     'witness_earlier_bulk_present')
            for filename, (identity, _) in pending.items():
                need(reuse_file_identity(filename) == identity, 'witness_file_changed')
            need(all(not os.path.lexists(filename) for filename in absent_paths), 'witness_file_appeared')
            for folder, expected in mount_directories.items():
                info = folder.stat()
                need((info.st_dev, info.st_ino) == expected, 'witness_directory_changed')
            scope_ids = {mount_directories[scope] for scope in scopes}
            watched_ids = set(mount_directories.values()) | {identity[:2] for identity, _ in pending.values()}
            watched_ids.update(identity[:2] for identity in proof_identities.values())
            watched_ids.update(identity[:2] for _, old_proofs in earlier for identity, _ in old_proofs.values())
            rows = docker('GET', '/containers/json?all=1')
            need(isinstance(rows, list) and len(rows) <= 1024, 'witness_containers')
            nonces = {target['nonce'], *(old['nonce'] for old in FAILED_UPLOAD_TARGETS)}
            for item in rows:
                row = docker('GET', '/containers/' + item['Id'] + '/json')
                need(row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') not in nonces, 'witness_candidate_exists')
                for mount in row.get('Mounts', []):
                    source = mount.get('Source')
                    if not source:
                        continue
                    need(isinstance(source, str) and Path(source).is_absolute(), 'witness_mount_path')
                    mounted = Path(source).resolve()
                    need(all(mounted != scope and mounted not in scope.parents and scope not in mounted.parents for scope in scopes),
                         'witness_files_mounted')
                    info = mounted.stat()
                    need((info.st_dev, info.st_ino) not in watched_ids, 'witness_mount_inode_alias')
                    for parent in mounted.parents:
                        info = parent.stat()
                        need((info.st_dev, info.st_ino) not in scope_ids, 'witness_mount_inode_alias')
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')

        fence()
        # Check every remaining target before the first unlink. The accepted
        # current is protected by its persisted browser proof and file identities.
        for filename, (identity, descriptor) in pending.items():
            need(file_sha(filename) == descriptor['sha256'] and reuse_file_identity(filename) == identity, 'witness_file_hash')
        fence()
        free_before = disk_free_bytes()
        deleted = freed = 0
        for filename in list(pending):
            fence()
            identity, descriptor = pending[filename]
            need(reuse_file_identity(filename) == identity, 'witness_file_changed')
            filename.unlink()
            directory_fd = os.open(filename.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            need(not os.path.lexists(filename), 'witness_file_still_present')
            del pending[filename]
            absent_paths.add(filename)
            deleted += 1
            freed += descriptor['bytes']
        for folder in (directory, directory / 'generation'):
            directory_fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        fence()
        free_after = disk_free_bytes()
        return {'version': 1, 'kind': 'china-failed-witness-prune-v1', 'phase': 'after-first-acceptance', 'completed': True,
                'runtimeSha': reference['runtimeSha'], 'generationId': reference['generationId'],
                'targetIndex': target_index, 'targetFailedAttempt': dict(target), 'earlierBulkFilesAbsent': 8,
                'filesDeleted': deleted, 'freedBytes': freed, 'alreadyAbsentFiles': absent,
                'diskFreeBytesBefore': free_before, 'diskFreeBytesAfter': free_after,
                'retiredContainers': 0, 'imagesDeleted': 0, 'directoriesDeleted': 0,
                'privateGenerationDeletes': 0, 'acceptedStateWrites': 0, 'intentStateWrites': 0}
    finally:
        os.close(lock)


class ResolvedFailedUploadCleanup:
    """One fixed, resolved 860 rollback permits eight local bulk unlinks.

    Preparation seals every witness/remaining-target hash under the runtime
    flock. Each subsequent request carries freshly read REG state and lease;
    the controller cannot request an arbitrary path, target or unlink order.
    Disconnecting releases only this flock, with no publication-state writes.
    """
    def __init__(self, authority):
        self.lock = None
        self.finished = False
        self.next_index = self.deleted = self.logical_bytes = 0
        self.authority = copy.deepcopy(authority)
        self.check_authority(authority)
        self.lock = reuse_lock()
        try:
            self.prepare()
        except BaseException:
            self.close()
            raise

    def check_authority(self, authority):
        need(isinstance(authority, dict) and set(authority) == {'publicationState', 'lease'}, 'resolved_authority')
        need(authority == self.authority, 'resolved_authority_changed')
        view = authority['publicationState']
        need(isinstance(view, dict) and set(view) == {'accepted', 'intent'}, 'resolved_state')
        for observation in (*view.values(), authority['lease']):
            need(isinstance(observation, dict) and set(observation) == {'found', 'etag', 'sha256', 'value'}, 'resolved_observation')
        state = checked_observation(view['accepted'])
        need(set(state) == {'version', 'kind', 'market', 'revision', 'current', 'rollback', 'commit', 'pending'}
             and state['version'] == 1 and state['kind'] == 'china-accepted-state-v1' and state['market'] == 'china'
             and type(state['revision']) is int and state['revision'] > 0
             and all(state[key] is None for key in ('current', 'rollback', 'commit', 'pending')), 'resolved_empty_state')
        intent = checked_observation(view['intent'])
        target = RESOLVED_CLEANUP_WITNESS
        need(set(intent) == {'version', 'kind', 'market', 'revision', 'nonce', 'owner', 'createdAt', 'candidate', 'previous', 'status', 'resolution'}
             and intent['version'] == 1 and intent['kind'] == 'china-publication-intent-v1' and intent['market'] == 'china'
             and type(intent['revision']) is int and intent['revision'] > 0 and intent['nonce'] == target['nonce']
             and intent['status'] == 'aborted', 'resolved_intent')
        previous = checked_observation(intent['previous'], allow_absent=True)
        if previous is not None:
            need(set(previous) == set(state) and all(previous[key] == state[key] for key in state if key != 'revision')
                 and type(previous['revision']) is int and previous['revision'] > 0, 'resolved_previous')
        need(state['revision'] == (previous['revision'] if previous else 0) + 2, 'resolved_revision')
        candidate = intent['candidate']
        bindings = {'runtimeSha': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha', 'generationId': 'generationId',
                    'generationManifestSha256': 'generationManifestSha256', 'receiptSha256': 'privateGenerationReceiptSha256',
                    'imageId': 'imageId'}
        need(isinstance(candidate, dict) and set(candidate) == {'market', 'generationId', 'owner', 'receiptSha256', 'sourceDescriptorSha256',
             'generationManifestSha256', 'sourceCursor', 'sourceObservedAt', 'runtimeSha', 'pricingRuntimeSha', 'imageId'}
             and candidate['market'] == 'china' and all(candidate[key] == target[value] for key, value in bindings.items()), 'resolved_candidate')
        resolution = intent['resolution']
        need(isinstance(resolution, dict) and set(resolution) == {'kind', 'at', 'acceptedETag', 'acceptedSha256', 'hostReceiptSha256', 'rollbackProof'}
             and resolution['kind'] == 'rolled_back' and resolution['hostReceiptSha256'] is None
             and resolution['acceptedETag'] == view['accepted']['etag'] and resolution['acceptedSha256'] == view['accepted']['sha256'],
             'resolved_resolution')
        proof = resolution['rollbackProof']
        need(isinstance(proof, dict) and set(proof) == {'kind', 'hostRollbackBase64', 'hostRollbackSha256'}
             and proof['kind'] == 'china-rollback-proof-v1' and proof['hostRollbackSha256'] == target['rollbackSha256'], 'resolved_rollback_proof')
        raw, rollback = decode_report(proof['hostRollbackBase64'])
        need(sha(raw) == target['rollbackSha256'] and rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1'
             and rollback.get('nonce') == intent['nonce'] and rollback.get('release') == target['runtimeSha']
             and all(rollback.get(value) == candidate[key] for key, value in bindings.items() if key != 'runtimeSha')
             and rollback.get('sourceDescriptorSha256') == candidate['sourceDescriptorSha256']
             and rollback.get('previousAcceptedETag') == intent['previous']['etag']
             and rollback.get('previousAcceptedStateSha256') == intent['previous']['sha256']
             and rollback.get('retainedRuntimeSha') == RETAINED and rollback.get('retainedRunning') is True
             and rollback.get('ingressRestored') is True and rollback.get('candidateRemoved') is True, 'resolved_rollback_binding')
        lease = checked_observation(authority['lease'])
        need(set(lease) == {'version', 'kind', 'market', 'epoch', 'owner', 'nonce', 'status', 'acquiredAt', 'expiresAt', 'releasedAt'}
             and lease['version'] == 1 and lease['kind'] == 'china-market-lease-v1' and lease['market'] == 'china'
             and type(lease['epoch']) is int and lease['epoch'] > 0 and lease['status'] == 'held' and lease['releasedAt'] is None
             and isinstance(lease['nonce'], str) and re.fullmatch(r'[a-f0-9]{32}', lease['nonce'])
             and lease['nonce'] not in {row['nonce'] for row in (*RESOLVED_CLEANUP_TARGETS, RESOLVED_CLEANUP_WITNESS)}, 'resolved_lease')
        for instant in (lease['acquiredAt'], lease['expiresAt']):
            need(isinstance(instant, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', instant), 'resolved_lease')
        acquired = datetime.datetime.fromisoformat(lease['acquiredAt'].replace('Z', '+00:00')).timestamp()
        self.deadline = datetime.datetime.fromisoformat(lease['expiresAt'].replace('Z', '+00:00')).timestamp()
        need(acquired <= time.time() < self.deadline <= acquired + 2 * 60 * 60, 'resolved_lease_expired')

    @staticmethod
    def directory_identity(folder):
        private_directory(folder)
        info = folder.stat()
        return info.st_dev, info.st_ino, info.st_mode, info.st_uid

    @staticmethod
    def location(directory, name):
        return (directory if name in {'image.tar', 'regcloud-performance-gate.py', 'accepted-speed-baseline.json', 'acceptance.json'}
                else directory / 'generation') / name

    @staticmethod
    def disk_free_bytes():
        disk = os.statvfs(BASE)
        value = disk.f_bavail * disk.f_frsize
        need(type(value) is int and 0 <= value <= 9007199254740991, 'resolved_disk_capacity')
        return value

    def prepare(self):
        self.cuts, self.directories, self.proofs, self.kept, self.pending, self.absent = [], {}, {}, {}, {}, set()
        # A bind alias of /opt/avtocena, /opt or / still contains the protected
        # cuts even though its source path is outside BASE. Ancestors need only
        # stable directory identities; they need not have private permissions.
        self.mount_ancestors = {}
        for folder in BASE.parents:
            info = folder.stat()
            need(stat.S_ISDIR(info.st_mode), 'resolved_directory_changed')
            self.mount_ancestors[folder] = (info.st_dev, info.st_ino)
        for binding in (RESOLVED_CLEANUP_WITNESS, *RESOLVED_CLEANUP_TARGETS):
            directory = BASE / binding['runtimeSha'] / 'china-next' / binding['nonce']
            for folder in (BASE, directory.parent.parent, directory.parent, directory, directory / 'generation'):
                identity = self.directory_identity(folder)
                need(folder not in self.directories or self.directories[folder] == identity, 'resolved_directory_changed')
                self.directories[folder] = identity
            plan, plan_raw = diagnosis_json(directory / 'PLAN.json')
            rollback, rollback_raw = diagnosis_json(directory / 'ROLLED_BACK.json')
            need(sha(plan_raw) == binding['planSha256'] and sha(rollback_raw) == binding['rollbackSha256'], 'resolved_proof_hash')
            validate_plan(plan)
            need(not generation_update(plan) and all(plan.get(key) == value for key, value in binding.items()
                 if key not in ('planSha256', 'rollbackSha256')), 'resolved_plan')
            rollback_bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256',
                'imageId': 'imageId', 'previousAcceptedETag': 'previousAcceptedETag', 'previousAcceptedStateSha256': 'previousAcceptedStateSha256'}
            need(rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1'
                 and all(rollback.get(left) == plan.get(right) for left, right in rollback_bindings.items())
                 and rollback.get('retainedRuntimeSha') == RETAINED and rollback.get('retainedRunning') is True
                 and rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True
                 and re.fullmatch(r'[a-f0-9]{64}', rollback.get('retainedContainerId', ''))
                 and re.fullmatch(r'sha256:[a-f0-9]{64}', rollback.get('retainedImageId', '')), 'resolved_rollback')
            for name, raw in (('PLAN.json', plan_raw), ('ROLLED_BACK.json', rollback_raw)):
                self.proofs[directory / name] = (reuse_file_identity(directory / name), raw)
            self.cuts.append((directory, plan, rollback))
        view = self.authority['publicationState']
        witness_plan = self.cuts[0][1]
        intent = view['intent']['value']
        for _, plan, _ in self.cuts:
            need(plan['previousAcceptedETag'] == intent['previous']['etag'] and
                 plan['previousAcceptedStateSha256'] == intent['previous']['sha256'], 'resolved_witness_predecessor')
        need(self.proofs[self.cuts[0][0] / 'ROLLED_BACK.json'][1] ==
             base64.b64decode(intent['resolution']['rollbackProof']['hostRollbackBase64']), 'resolved_local_rollback')
        need(all(plan['sourceDescriptorSha256'] == witness_plan['sourceDescriptorSha256'] for _, plan, _ in self.cuts)
             and intent['candidate']['sourceDescriptorSha256'] == witness_plan['sourceDescriptorSha256'], 'resolved_source_binding')
        generation_reference({**intent['candidate'], 'runtimeSha': RESOLVED_CLEANUP_WITNESS['runtimeSha']}, RESOLVED_CLEANUP_WITNESS['nonce'])
        retained_receipt = self.cuts[0][2]
        regular(CONFIG, 1024 * 1024)
        self.ingress = CONFIG.read_bytes()
        retained = docker('GET', '/containers/' + retained_receipt['retainedContainerId'] + '/json')
        retained_env = env_map(retained)
        need(retained['Id'] == retained_receipt['retainedContainerId'] and retained['Image'] == retained_receipt['retainedImageId']
             and retained['State']['Running'] is True and retained_env.get('AVTOCENA_RELEASE_SHA') == RETAINED
             and retained_env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION
             and any(str(binding.get('HostPort', '')) == str(backend(self.ingress)) for ports in
                 (retained.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in ports), 'resolved_retained')
        self.retained_id, self.retained_identity = retained['Id'], protected_identity(retained)
        need(all(rollback['retainedContainerId'] == retained['Id'] and rollback['retainedImageId'] == retained['Image']
                 for _, _, rollback in self.cuts), 'resolved_retained_proofs')
        self.ordered_files = []
        for index, (directory, plan, _) in enumerate(self.cuts):
            descriptors = {row['name']: row for row in plan['files']}
            if index:
                need(sum(descriptors[name]['bytes'] for name in FAILED_UPLOAD_BULK_FILES) == RESOLVED_CLEANUP_BULK_BYTES[index - 1],
                     'resolved_bulk_bytes')
                self.ordered_files.extend((self.location(directory, name), descriptors[name]) for name in FAILED_UPLOAD_BULK_FILES)
            for descriptor in plan['files']:
                filename = self.location(directory, descriptor['name'])
                target = index > 0 and descriptor['name'] in FAILED_UPLOAD_BULK_FILES
                try:
                    identity = reuse_file_identity(filename)
                except FileNotFoundError:
                    need(target, 'resolved_protected_missing')
                    self.absent.add(filename)
                    continue
                need(identity[2] == descriptor['bytes'], 'resolved_file_size')
                (self.pending if target else self.kept)[filename] = (identity, descriptor)
        self.initial_absent = len(self.absent)
        self.absent_bytes = sum(descriptor['bytes'] for filename, descriptor in self.ordered_files if filename in self.absent)
        self.fence()
        # Hash all 11 witness files and all surviving target files before the
        # first unlink. Subsequent fences preserve their inode/time identities.
        for files in (self.kept, self.pending):
            for filename, (identity, descriptor) in files.items():
                self.fence()
                need(file_sha(filename) == descriptor['sha256'] and reuse_file_identity(filename) == identity, 'resolved_file_hash')
        self.fence()
        self.free_before = self.disk_free_bytes()

    def fence(self):
        self.check_authority(self.authority)
        regular(CONFIG, 1024 * 1024)
        need(CONFIG.read_bytes() == self.ingress, 'ingress_changed')
        need(protected_identity(docker('GET', '/containers/' + self.retained_id + '/json')) == self.retained_identity, 'resolved_retained_changed')
        health(backend(self.ingress), RETAINED)
        for directory, expected in self.directories.items():
            need(self.directory_identity(directory) == expected, 'resolved_directory_changed')
        for directory, expected in self.mount_ancestors.items():
            info = directory.stat()
            need(stat.S_ISDIR(info.st_mode) and (info.st_dev, info.st_ino) == expected, 'resolved_directory_changed')
        identities = []
        for filename, (identity, raw) in self.proofs.items():
            need(reuse_file_identity(filename) == identity and diagnosis_json(filename)[1] == raw, 'resolved_proof_changed')
            identities.append(identity[:2])
        for files in (self.kept, self.pending):
            for filename, (identity, _) in files.items():
                need(reuse_file_identity(filename) == identity, 'resolved_file_changed')
                identities.append(identity[:2])
        need(len(identities) == len(set(identities)), 'resolved_inode_alias')
        need(all(not os.path.lexists(filename) for filename in self.absent), 'resolved_file_appeared')
        for directory, _, _ in self.cuts:
            need(not os.path.lexists(directory / 'ACCEPTED.json') and not os.path.lexists(directory / 'ACCEPTED.pending'), 'resolved_accepted_file')
        witness = RESOLVED_CLEANUP_WITNESS
        image = docker('GET', '/images/' + witness['imageId'] + '/json')
        need(image.get('Id') == witness['imageId'] and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64'
             and image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == witness['runtimeSha'], 'resolved_witness_image')
        rows = docker('GET', '/containers/json?all=1')
        need(isinstance(rows, list) and len(rows) <= 1024, 'resolved_containers')
        scopes = [directory for directory, _, _ in self.cuts]
        scope_ids = {self.directories[scope][:2] for scope in scopes}
        watched_ids = (set(identities) | {identity[:2] for identity in self.directories.values()}
                       | set(self.mount_ancestors.values()))
        nonces = {row['nonce'] for row in (witness, *RESOLVED_CLEANUP_TARGETS)}
        for item in rows:
            need(isinstance(item, dict) and isinstance(item.get('Id'), str) and re.fullmatch(r'[a-f0-9]{64}', item['Id']), 'resolved_containers')
            row = docker('GET', '/containers/' + item['Id'] + '/json')
            need(row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') not in nonces, 'resolved_candidate_exists')
            need(isinstance(row.get('Mounts'), list), 'resolved_mounts')
            for mount in row['Mounts']:
                source = mount.get('Source')
                if not source:
                    continue
                need(isinstance(source, str) and Path(source).is_absolute(), 'resolved_mount_path')
                mounted = Path(source).resolve()
                need(all(mounted != scope and mounted not in scope.parents and scope not in mounted.parents for scope in scopes),
                     'resolved_files_mounted')
                info = mounted.stat()
                need((info.st_dev, info.st_ino) not in watched_ids, 'resolved_mount_inode_alias')
                for parent in mounted.parents:
                    info = parent.stat()
                    need((info.st_dev, info.st_ino) not in scope_ids, 'resolved_mount_inode_alias')
        need(CONFIG.read_bytes() == self.ingress, 'ingress_changed')

    def prepared(self):
        return {'version': 1, 'kind': 'china-resolved-cleanup-prepared-v1', 'prepared': True,
                'liveRuntimeSha': RETAINED, 'protectedFailedAttempt': dict(RESOLVED_CLEANUP_WITNESS), 'protectedFilesVerified': 11,
                'targetFailedAttempts': [dict(row) for row in RESOLVED_CLEANUP_TARGETS],
                'targetFileBytes': [descriptor['bytes'] for _, descriptor in self.ordered_files],
                'alreadyAbsentFiles': self.initial_absent, 'alreadyAbsentBytes': self.absent_bytes}

    def step(self, params):
        need(isinstance(params, dict) and set(params) == {'action', 'authority', 'index'} and params['action'] == 'unlink'
             and type(params['index']) is int and params['index'] == self.next_index < 8 and not self.finished, 'resolved_step')
        self.check_authority(params['authority'])
        self.fence()
        filename, descriptor = self.ordered_files[self.next_index]
        deleted = filename in self.pending
        if deleted:
            identity, _ = self.pending[filename]
            parent_fd = os.open(filename.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                parent = os.fstat(parent_fd)
                need((parent.st_dev, parent.st_ino) == self.directories[filename.parent][:2], 'resolved_directory_changed')
                info = os.stat(filename.name, dir_fd=parent_fd, follow_symlinks=False)
                need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o400
                     and (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) == identity, 'resolved_file_changed')
                need(time.time() < self.deadline, 'resolved_lease_expired')
                os.unlink(filename.name, dir_fd=parent_fd)
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            need(not os.path.lexists(filename), 'resolved_file_still_present')
            del self.pending[filename]
            self.absent.add(filename)
            self.deleted += 1
            self.logical_bytes += descriptor['bytes']
        self.next_index += 1
        self.fence()
        return {'version': 1, 'kind': 'china-resolved-cleanup-step-v1', 'index': params['index'],
                'deleted': deleted, 'alreadyAbsent': not deleted, 'logicalBytesUnlinked': descriptor['bytes'] if deleted else 0}

    def finish(self, params):
        need(isinstance(params, dict) and set(params) == {'action', 'authority'} and params['action'] == 'finish'
             and self.next_index == 8 and not self.pending and not self.finished, 'resolved_finish')
        self.check_authority(params['authority'])
        self.fence()
        # Also persist directory metadata after a resumed, already-absent unlink.
        for directory, _, _ in self.cuts[1:]:
            for folder in (directory, directory / 'generation'):
                fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
                try:
                    info = os.fstat(fd)
                    need((info.st_dev, info.st_ino) == self.directories[folder][:2], 'resolved_directory_changed')
                    os.fsync(fd)
                finally:
                    os.close(fd)
        self.fence()
        self.finished = True
        return {'version': 1, 'kind': 'china-resolved-failed-upload-prune-v1', 'phase': 'after-resolved-rollback', 'completed': True,
                'liveRuntimeSha': RETAINED, 'protectedFailedAttempt': dict(RESOLVED_CLEANUP_WITNESS), 'protectedFilesVerified': 11,
                'targetFailedAttempts': [dict(row) for row in RESOLVED_CLEANUP_TARGETS],
                'filesDeleted': self.deleted, 'logicalBytesUnlinked': self.logical_bytes,
                'alreadyAbsentFiles': self.initial_absent, 'alreadyAbsentBytes': self.absent_bytes,
                'diskFreeBytesBefore': self.free_before, 'diskFreeBytesAfter': self.disk_free_bytes(),
                'retiredContainers': 0, 'imagesDeleted': 0, 'directoriesDeleted': 0,
                'privateGenerationDeletes': 0, 'acceptedStateWrites': 0, 'intentStateWrites': 0}

    def close(self):
        if self.lock is not None:
            os.close(self.lock)
            self.lock = None


def reuse_file_identity(filename):
    info = regular(filename)
    need(stat.S_IMODE(info.st_mode) == 0o400, 'reuse_file_permissions')
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def reuse_copy_file(source, target, descriptor, identity):
    """A new private inode, never a hard link, with verified source and readback.
    Only this invocation's incomplete new file is removed on a copy failure."""
    need(reuse_file_identity(source) == identity, 'reuse_source_changed')
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    target_fd = None
    created = False
    try:
        source_stat = os.fstat(source_fd)
        need((source_stat.st_dev, source_stat.st_ino, source_stat.st_size,
              source_stat.st_mtime_ns, source_stat.st_ctime_ns) == identity, 'reuse_source_changed')
        target_fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        created = True
        digest = hashlib.sha256()
        total = 0
        with os.fdopen(target_fd, 'wb') as output:
            target_fd = None
            while True:
                block = os.read(source_fd, 1024 * 1024)
                if not block:
                    break
                total += len(block)
                need(total <= descriptor['bytes'], 'reuse_copy_size')
                digest.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        need(total == descriptor['bytes'] and digest.hexdigest() == descriptor['sha256'], 'reuse_copy_hash')
        need(reuse_file_identity(source) == identity, 'reuse_source_changed')
        copied = reuse_file_identity(target)
        need(copied[:2] != identity[:2] and copied[2] == descriptor['bytes'] and
             file_sha(target) == descriptor['sha256'] and reuse_file_identity(target) == copied, 'reuse_copy_readback')
    except BaseException:
        if target_fd is not None:
            os.close(target_fd)
        # The caller supplies an absent path below its newly created private
        # nonce. Existing files are never unlinked by this helper.
        if created and target.exists():
            regular(target)
            target.unlink()
        raise
    finally:
        os.close(source_fd)


def resume_failed_upload(params):
    """Copy one pinned, fully rolled-back first release into a fresh nonce.
    The installed image is reused; all publication gates remain in Host.start
    and its existing methods. No original byte, receipt or container is changed."""
    need(isinstance(params, dict) and set(params) == {'source', 'nonce', 'controllerSha',
         'previousAcceptedETag', 'previousAcceptedStateSha256'}, 'reuse_parameters')
    source = params.get('source')
    need(isinstance(source, dict) and set(source) == {'runtimeSha', 'nonce', 'planSha256', 'rollbackSha256'} and
         re.fullmatch(r'[a-f0-9]{40}', source.get('runtimeSha', '')) and
         re.fullmatch(r'[a-f0-9]{32}', source.get('nonce', '')) and
         all(re.fullmatch(r'[a-f0-9]{64}', source.get(key, '')) for key in ('planSha256', 'rollbackSha256')) and
         re.fullmatch(r'[a-f0-9]{32}', params.get('nonce', '')) and params['nonce'] != source['nonce'] and
         re.fullmatch(r'[a-f0-9]{40}', params.get('controllerSha', '')), 'reuse_identity')
    old_directory = BASE / source['runtimeSha'] / 'china-next' / source['nonce']
    for directory in (BASE, old_directory.parent.parent, old_directory.parent, old_directory, old_directory / 'generation'):
        private_directory(directory)
    old_plan, old_plan_raw = diagnosis_json(old_directory / 'PLAN.json')
    validate_plan(old_plan)
    need(not generation_update(old_plan) and old_plan['runtimeSha'] == source['runtimeSha'] and
         old_plan['nonce'] == source['nonce'] and sha(old_plan_raw) == source['planSha256'], 'reuse_plan')
    need(not (old_directory / 'ACCEPTED.json').exists() and not (old_directory / 'ACCEPTED.pending').exists(), 'reuse_accepted')
    rollback, rollback_raw = diagnosis_json(old_directory / 'ROLLED_BACK.json')
    bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha', 'imageId': 'imageId',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256'}
    need(sha(rollback_raw) == source['rollbackSha256'] and rollback.get('version') == 1 and
         rollback.get('kind') == 'china-host-rollback-v1' and all(rollback.get(left) == old_plan[right] for left, right in bindings.items()) and
         rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True and
         rollback.get('retainedRunning') is True and rollback.get('retainedRuntimeSha') == RETAINED and
         re.fullmatch(r'[a-f0-9]{64}', rollback.get('retainedContainerId', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', rollback.get('retainedImageId', '')), 'reuse_rollback')
    need(all(params[key] == old_plan.get(key) for key in ('previousAcceptedETag', 'previousAcceptedStateSha256')),
         'reuse_state_changed')
    plan = {**copy.deepcopy(old_plan), 'nonce': params['nonce'], 'controllerSha': params['controllerSha'], 'reuseSource': dict(source)}
    validate_plan(plan)
    directory = old_directory.parent / plan['nonce']
    generation_names = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                        'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'}
    source_path = lambda name: (old_directory / 'generation' if name in generation_names else old_directory) / name
    target_path = lambda name: (directory / 'generation' if name in generation_names else directory) / name
    identities = {row['name']: reuse_file_identity(source_path(row['name'])) for row in plan['files']}
    need(all(identities[row['name']][2] == row['bytes'] for row in plan['files']), 'reuse_source_size')
    total_bytes = sum(row['bytes'] for row in plan['files'])
    copy_proof = {'version': 1, 'kind': 'china-host-local-reuse-v1', 'source': source,
                  'planSha256': sha(json_bytes(plan)), 'copiedFiles': len(plan['files']), 'copiedBytes': total_bytes}
    lock = reuse_lock()
    host = None
    try:
        regular(CONFIG, 1024 * 1024)
        ingress = CONFIG.read_bytes()
        retained = docker('GET', '/containers/' + rollback['retainedContainerId'] + '/json')
        retained_identity = protected_identity(retained)
        retained_raw_mounts = copy.deepcopy(retained['Mounts'])
        mount_order_variations = 0
        retained_env = env_map(retained)
        need(retained['Image'] == rollback['retainedImageId'] and retained['State']['Running'] is True and
             retained_env.get('AVTOCENA_RELEASE_SHA') == RETAINED and retained_env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
             any(str(binding.get('HostPort', '')) == str(backend(ingress)) for bindings in
                 (retained.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings), 'reuse_retained')
        image = docker('GET', '/images/' + plan['imageId'] + '/json')
        need(image.get('Id') == plan['imageId'] and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64' and
             image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == plan['runtimeSha'], 'reuse_image')
        def fence():
            nonlocal mount_order_variations
            current = docker('GET', '/containers/' + retained['Id'] + '/json')
            mount_order_variations += int(retained_snapshot_guard(ingress, CONFIG.read_bytes(), retained_identity,
                                          current, retained_raw_mounts, 'reuse_retained_changed'))
            need(diagnosis_json(old_directory / 'PLAN.json')[1] == old_plan_raw and
                 diagnosis_json(old_directory / 'ROLLED_BACK.json')[1] == rollback_raw and
                 not (old_directory / 'ACCEPTED.json').exists() and not (old_directory / 'ACCEPTED.pending').exists(), 'reuse_source_changed')
            rows = docker('GET', '/containers/json?all=1')
            need(isinstance(rows, list) and len(rows) <= 1024, 'reuse_containers')
            for item in rows:
                row = docker('GET', '/containers/' + item['Id'] + '/json')
                need(row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') not in {source['nonce'], plan['nonce']},
                     'reuse_candidate_exists')
                for mount in row.get('Mounts', []):
                    mounted = mount.get('Source')
                    if not mounted:
                        continue
                    need(isinstance(mounted, str) and Path(mounted).is_absolute(), 'reuse_mount_path')
                    mounted = Path(mounted).resolve()
                    need(all(mounted != scope and mounted not in scope.parents and scope not in mounted.parents
                             for scope in (old_directory, directory)), 'reuse_mounted')
        fence()
        already_copied = directory.exists()
        if already_copied:
            private_directory(directory); private_directory(directory / 'generation')
            need(diagnosis_json(directory / 'PLAN.json')[1] == json_bytes(plan) and
                 not (directory / 'ACCEPTED.json').exists() and not (directory / 'ROLLED_BACK.json').exists() and
                 not (directory / 'ACCEPTED.pending').exists() and
                 diagnosis_json(directory / 'REUSED.json')[0] == copy_proof, 'reuse_existing_copy')
        else:
            disk = os.statvfs(BASE)
            # Worst case for ordinary copies, plus bounded metadata/headroom.
            # This test precedes mkdir, PLAN, temporary files or any write.
            need(disk.f_bavail * disk.f_frsize >= total_bytes + 64 * 1024 * 1024, 'reuse_disk_capacity')
        for descriptor in plan['files']:
            filename = source_path(descriptor['name'])
            need(file_sha(filename) == descriptor['sha256'] and
                 reuse_file_identity(filename) == identities[descriptor['name']], 'reuse_source_hash')
        generation, generation_raw = diagnosis_json(source_path('GENERATION.json'))
        oracle, oracle_raw = diagnosis_json(source_path('acceptance.json'))
        need(generation.get('generationId') == plan['generationId'] and generation.get('runtimeSha') == plan['pricingRuntimeSha'] and
             generation.get('prepared') is True and generation.get('source', {}).get('supplierLatestVerified') is True, 'reuse_generation')
        need(oracle.get('version') == 1 and oracle.get('runtimeSha') == plan['runtimeSha'] and
             oracle.get('pricingRuntimeSha') == plan['pricingRuntimeSha'] and
             oracle.get('generationManifestSha256') == plan['generationManifestSha256'] and
             isinstance(oracle.get('cases'), list) and len(oracle['cases']) >= 8, 'reuse_oracle')
        fence()
        if not already_copied:
            host = Host(plan)
            for descriptor in plan['files']:
                fence()
                reuse_copy_file(source_path(descriptor['name']), target_path(descriptor['name']), descriptor,
                                identities[descriptor['name']])
            new_file(directory / 'REUSED.json', json_bytes(copy_proof))
            for folder in (directory / 'generation', directory, directory.parent):
                fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
                try: os.fsync(fd)
                finally: os.close(fd)
        else:
            for descriptor in plan['files']:
                filename = target_path(descriptor['name'])
                identity = reuse_file_identity(filename)
                need(identity[2] == descriptor['bytes'] and identity[:2] != identities[descriptor['name']][:2] and
                     file_sha(filename) == descriptor['sha256'] and reuse_file_identity(filename) == identity, 'reuse_copy_readback')
            host = Host.__new__(Host)
            host.initialize_session(plan)
        fence()
        host.uploaded = set(FILE_NAMES)
        host.reuse_verified = True
        host.reuse_retained_identity = retained_identity
        host.retained_raw_mounts = retained_raw_mounts
        host.retained_mount_order_variations = mount_order_variations
        host.lock = lock
        lock = None
        return host, {'initialized': True, 'reused': True, 'plan': plan,
                      'generationBase64': base64.b64encode(generation_raw).decode(), 'oracleBase64': base64.b64encode(oracle_raw).decode(),
                      'copiedFiles': len(plan['files']), 'copiedBytes': total_bytes}
    finally:
        if lock is not None:
            os.close(lock)


class Host:
    def __init__(self, plan):
        validate_plan(plan)
        if code_update(plan):
            checked_code_image_storage_proof(plan)
        # Refuse an inadmissible data update before any attempt directory,
        # PLAN.json or upload is written. No old generation is removed here.
        admission = generation_disk_admission(plan, BASE) if generation_update(plan) else None
        self.plan = plan
        self.directory = BASE / plan['runtimeSha'] / 'china-next' / plan['nonce']
        need(BASE.resolve() == BASE and BASE.is_dir() and BASE.stat().st_uid == 0 and not BASE.stat().st_mode & 0o022, 'release_root')
        for parent in (self.directory.parent.parent, self.directory.parent):
            parent.mkdir(mode=0o700, exist_ok=True)
            need(parent.resolve() == parent and parent.is_dir() and parent.stat().st_uid == 0 and stat.S_IMODE(parent.stat().st_mode) == 0o700, 'release_parent')
        self.directory.mkdir(mode=0o700)
        new_file(self.directory / 'PLAN.json', json_bytes(plan))
        self.generation = self.directory / 'generation'
        self.generation.mkdir(mode=0o700)
        self.initialize_session(plan)
        self.generation_disk_admission = admission

    def initialize_session(self, plan):
        self.plan = plan
        self.directory = BASE / plan['runtimeSha'] / 'china-next' / plan['nonce']
        self.generation = self.directory / 'generation'
        self.uploaded = set()
        self.candidate = None
        self.switched = False
        self.accepted = False
        self.functional_passed = False
        self.speed_passed = False
        self.timing_observed = False
        self.verdict_deadline = None
        self.lock = None
        self.original = self.proposed = None
        self.retained = None
        self.restart = 'no'

    def file_path(self, name):
        return (self.generation if name in {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                                            'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'} else self.directory) / name

    def prepare_code_generation(self):
        """Copy the already accepted immutable generation into this nonce.
        Preserve independent inode ownership for the existing retirement path;
        no network restore, hard link, repricing or source refresh is involved."""
        need(code_update(self.plan) and self.lock is not None and self.retained is not None, 'code_copy_phase')
        previous, receipt, _ = accepted_predecessor(self.plan)
        directory, previous_plan = reference_plan(previous, receipt)
        source_plan_sha = self.plan['codeSourcePlanSha256']
        need(file_sha(directory / 'PLAN.json') == source_plan_sha, 'code_source_plan_changed')
        old_files = {row['name']: row for row in previous_plan['files']}
        new_files = {row['name']: row for row in self.plan['files']}
        need(all(old_files.get(name) == new_files.get(name) for name in GENERATION_FILES), 'code_generation_descriptors')
        check_mounted_reference(self.retained, previous, receipt['nonce'])
        regular(directory / 'acceptance.json', 256 * 1024)
        old_raw = (directory / 'acceptance.json').read_bytes()
        need(sha(old_raw) == self.plan['codeSourceOracleSha256'] == old_files['acceptance.json']['sha256'] and
             len(old_raw) == old_files['acceptance.json']['bytes'], 'code_oracle_changed')
        old_oracle = json.loads(old_raw)
        checked_code_oracle(old_oracle, previous)
        regular(self.directory / 'acceptance.json', 256 * 1024)
        new_raw = (self.directory / 'acceptance.json').read_bytes()
        need(len(new_raw) == new_files['acceptance.json']['bytes'] and
             sha(new_raw) == new_files['acceptance.json']['sha256'] and
             json.loads(new_raw) == {**old_oracle, 'runtimeSha': self.plan['runtimeSha']}, 'code_oracle_scope')
        regular(self.directory / 'image-receipt.json', 256 * 1024)
        image_raw = (self.directory / 'image-receipt.json').read_bytes()
        need(len(image_raw) == new_files['image-receipt.json']['bytes'] and
             sha(image_raw) == new_files['image-receipt.json']['sha256'], 'code_image_receipt_hash')
        image = json.loads(image_raw)
        scope = code_scope(self.plan)
        required_code_files = CODE_SCOPE_FILES[scope]
        if scope == JAPAN_STABILITY_CODE_SCOPE:
            required_code_files = checked_japan_stability_image_files(image.get('runtimeFiles'), japan_observed_timing(self.plan),
                                                                      self.plan.get('retainedRuntime'), self.plan.get('countAcceptance'))
        need(image.get('version') == 1 and image.get('kind') == 'china-runtime-image-v1' and image.get('market') == 'china' and
             all(image.get(key) == self.plan[key] for key in ('runtimeSha', 'pricingRuntimeSha', 'runtimeTree',
                                                            'runtimeDiffSha256', 'retainedRuntime', 'imageId')) and
             image.get('bytes') == new_files['image.tar']['bytes'] and image.get('sha256') == new_files['image.tar']['sha256'] and
             image.get('platform') == 'linux/amd64' and image.get('archiveRoundTripVerified') is True and
             image.get('protectedPathsUnchanged') is True and image.get('privateDataIncluded') is False and
             image.get('servingCompatibility', {}).get('protectedPricingPathsUnchanged') is True and
             image.get('codeScope', PHOTO_CODE_SCOPE) == scope and
             isinstance(image.get('runtimeFiles'), list) and len(image['runtimeFiles']) == len(required_code_files) and
             all(isinstance(name, str) for name in image['runtimeFiles']) and
             set(image['runtimeFiles']) == required_code_files and
             type(image.get('imageUnpackedBytes')) is int and image['imageUnpackedBytes'] > 0, 'code_image_receipt')
        need(image.get('acceptancePolicy') == self.plan.get('acceptancePolicy'), 'timing_policy_image_binding')
        need(image.get('countAcceptance') == self.plan.get('countAcceptance')
             and ('countAcceptance' in image) == ('countAcceptance' in self.plan), 'count_acceptance_image_binding')
        if scope in (CRM_CHINA_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_SCOPE):
            need(image.get('protectedPathExceptions') == CRM_CHINA_PROTECTED_EXCEPTIONS, 'code_crm_image_scope')
        if scope in (JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE):
            need('protectedPathExceptions' not in image, 'code_pagination_image_scope')
        storage = checked_code_image_storage_proof(self.plan, image)
        # Uploaded archives already occupy disk. Reserve the complete packed
        # content and actual unpacked snapshots measured in the isolated daemon.
        # Docker 29.1.3 inspect.Size in historical receipts is packed-only.
        copied_bytes = sum(new_files[name]['bytes'] for name in GENERATION_FILES)
        self.code_image_storage_bytes = storage['contentBytes'] + storage['unpackedBytes']
        usage = os.statvfs(self.directory)
        need(usage.f_bavail * usage.f_frsize >= copied_bytes + self.code_image_storage_bytes + RELEASE_DISK_OPERATING_RESERVE,
             'code_disk_space')
        identities = {name: reuse_file_identity(directory / 'generation' / name) for name in GENERATION_FILES}
        need(all(identities[name][2] == new_files[name]['bytes'] for name in GENERATION_FILES), 'code_source_size')
        for name in sorted(GENERATION_FILES):
            self.guard()
            need(file_sha(directory / 'PLAN.json') == source_plan_sha, 'code_source_plan_changed')
            reuse_copy_file(directory / 'generation' / name, self.generation / name, new_files[name], identities[name])
        generation_reference({**previous, 'runtimeSha': self.plan['runtimeSha']}, self.plan['nonce'])
        need(all(reuse_file_identity(directory / 'generation' / name) == identities[name] for name in GENERATION_FILES) and
             file_sha(directory / 'PLAN.json') == source_plan_sha, 'code_source_changed')
        descriptor = os.open(self.generation, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        self.guard()
        self.code_generation_copy = {'files': len(GENERATION_FILES), 'bytes': copied_bytes,
                                     'sourceDownloads': 0, 'generationId': self.plan['generationId']}

    def upload(self, name, stream):
        need(name in expected_files(self.plan) and name not in self.uploaded and not self.candidate, 'upload_scope')
        descriptor = next(f for f in self.plan['files'] if f['name'] == name)
        data_update = generation_update(self.plan)
        if data_update:
            # A different disk consumer may have invalidated init admission.
            # Both the compressed transport and raw result coexist temporarily.
            require_generation_space(self.directory, descriptor['compressedBytes'] + descriptor['bytes'])
        packed = self.directory / (name + '.incoming.gz')
        digest = hashlib.sha256()
        fd = os.open(packed, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as target:
            remaining = descriptor['compressedBytes']
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                need(chunk, 'upload_incomplete')
                if data_update:
                    require_generation_space(self.directory, len(chunk))
                target.write(chunk)
                digest.update(chunk)
                remaining -= len(chunk)
            target.flush()
            os.fsync(target.fileno())
        if data_update:
            require_generation_space(self.directory, descriptor['bytes'])
        need(digest.hexdigest() == descriptor['compressedSha256'], 'upload_checksum')
        filename = self.file_path(name)
        digest = hashlib.sha256()
        total = 0
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(fd, 'wb') as target, gzip.open(packed, 'rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                total += len(chunk)
                need(total <= descriptor['bytes'], 'decoded_size')
                if data_update:
                    require_generation_space(self.directory, len(chunk))
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        if data_update:
            require_generation_space(self.directory)
        need(total == descriptor['bytes'] and digest.hexdigest() == descriptor['sha256'], 'decoded_checksum')
        need(file_sha(filename) == descriptor['sha256'], 'local_readback')
        packed.unlink()
        self.uploaded.add(name)
        return {'file': name, 'bytes': total, 'verified': True}

    def guard(self):
        need(self.lock is not None and self.retained is not None, 'not_locked')
        current = docker('GET', '/containers/' + self.retained['Id'] + '/json')
        regular(CONFIG, 1024 * 1024)
        ingress = CONFIG.read_bytes()
        need(ingress == (self.proposed if self.switched else self.original), 'ingress_changed')
        raw_mounts = getattr(self, 'retained_raw_mounts', self.retained['Mounts'])
        changed_order = retained_snapshot_guard(ingress, ingress, self.retained_identity, current, raw_mounts, 'retained_changed')
        self.retained_mount_order_variations = getattr(self, 'retained_mount_order_variations', 0) + int(changed_order)
        health(self.old_port, retained_runtime(self.plan))

    def start(self):
        need(self.uploaded == expected_files(self.plan) and self.candidate is None, 'upload_not_complete')
        if generation_update(self.plan):
            require_generation_space(self.directory)
        if not getattr(self, 'reuse_verified', False):
            self.lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            info = os.fstat(self.lock)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'runtime_lock')
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            need(self.lock is not None, 'reuse_lock_lost')
        regular(CONFIG, 1024 * 1024)
        self.original = CONFIG.read_bytes()
        self.old_port = backend(self.original)
        rows = docker('GET', '/containers/json?all=1')
        inspected = [docker('GET', '/containers/' + row['Id'] + '/json') for row in rows]
        serving = [row for row in inspected if any(str(binding.get('HostPort', '')) == str(self.old_port)
                   for bindings in (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings)]
        need(len(serving) == 1, 'serving_container')
        self.retained = serving[0]
        if getattr(self, 'reuse_verified', False):
            changed_order = retained_snapshot_guard(self.original, CONFIG.read_bytes(), self.reuse_retained_identity,
                self.retained, self.retained_raw_mounts, 'reuse_retained_changed')
            self.retained_mount_order_variations += int(changed_order)
        else:
            self.retained_raw_mounts = copy.deepcopy(self.retained['Mounts'])
            self.retained_mount_order_variations = 0
        env = env_map(self.retained)
        need(env.get('AVTOCENA_RELEASE_SHA') == retained_runtime(self.plan) and env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
             self.retained['State']['Running'] and not self.retained['HostConfig']['Privileged'], 'serving_identity')
        need(self.retained['Config'].get('WorkingDir') == '/app' and self.retained['Config'].get('User', '') in ('', 'root', '0'), 'serving_config')
        mounts = self.retained.get('Mounts', [])
        need(mounts and all(row.get('Type') == 'bind' and row.get('RW') is False and
             row.get('Destination') != '/var/run/docker.sock' for row in mounts), 'serving_mounts')
        private = [row for row in mounts if row['Destination'] == '/app/data/knowledge/encyclopedia/calculation-v1.json']
        need(len(private) == 1 and file_sha(Path(private[0]['Source'])) ==
             '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c', 'encyclopedia_unchanged')
        previous_generation = None
        if accepted_update(self.plan):
            previous, previous_receipt, previous_raw = accepted_predecessor(self.plan)
            outcome = read_outcome({'runtimeSha': previous['runtimeSha'], 'nonce': previous_receipt['nonce']})
            need(outcome.get('status') == 'accepted' and
                 outcome.get('hostReceiptBase64') == base64.b64encode(previous_raw).decode() and
                 outcome.get('hostReceiptSha256') == sha(previous_raw), 'predecessor_not_accepted')
            previous_generation = check_mounted_reference(self.retained, previous, previous_receipt['nonce'])
        self.retained_identity = protected_identity(self.retained)
        self.guard()
        if code_update(self.plan):
            self.prepare_code_generation()
        claimed = {int(binding['HostPort']) for row in inspected for bindings in
                   (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings
                   if str(binding.get('HostPort', '')).isdigit()}
        ports = [port for port in range(3004, 3011) if port not in claimed]
        need(ports, 'candidate_port_unavailable')
        self.port = ports[0]
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(('127.0.0.1', self.port))
        if not generation_update(self.plan) and not getattr(self, 'reuse_verified', False):
            if code_update(self.plan):
                # Re-observe after the potentially large generation copy. A
                # concurrent disk consumer must not invalidate preflight.
                usage = os.statvfs(self.directory)
                need(usage.f_bavail * usage.f_frsize >= self.code_image_storage_bytes + RELEASE_DISK_OPERATING_RESERVE,
                     'code_disk_space')
            info = docker('GET', '/info')
            need(info.get('ServerVersion') == '29.1.3' and
                 ['driver-type', 'io.containerd.snapshotter.v1'] in info.get('DriverStatus', []), 'image_store')
            command(['/usr/bin/docker', 'load', '--input', str(self.directory / 'image.tar')], timeout=900)
        image = docker('GET', '/images/' + self.plan['imageId'] + '/json')
        need(image.get('Id') == self.plan['imageId'] and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64' and
             image['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == self.plan['runtimeSha'], 'image_identity')
        if code_update(self.plan):
            need(image.get('Descriptor', {}).get('digest') == self.plan['imageId'], 'code_image_descriptor')
        generation = json.loads((self.generation / 'GENERATION.json').read_bytes())
        need(generation.get('generationId') == self.plan['generationId'] and generation.get('runtimeSha') == self.plan['pricingRuntimeSha'] and
             generation.get('prepared') is True and generation.get('source', {}).get('supplierLatestVerified') is True, 'generation_identity')
        if accepted_update(self.plan):
            need(generation['calculationVersion'] == previous_generation.get('calculationVersion') ==
                 env.get('AVTOCENA_BUILD_CALCULATION_VERSION'), 'data_only_calculation_version')
            env['CATALOG_CHINA_LOCAL_MANIFEST_SHA256'] = self.plan['generationManifestSha256']
            if code_update(self.plan):
                # All other environment entries retain their values and order.
                env['AVTOCENA_RELEASE_SHA'] = self.plan['runtimeSha']
            candidate_env = [item.split('=', 1)[0] + '=' + env[item.split('=', 1)[0]] for item in self.retained['Config']['Env']]
            old_mount = next(row for row in mounts if row['Destination'] == GENERATION_MOUNT)
            old_bind = old_mount['Source'] + ':' + GENERATION_MOUNT + ':ro'
            retained_binds = self.retained['HostConfig'].get('Binds')
            need(isinstance(retained_binds, list) and retained_binds.count(old_bind) == 1 and len(retained_binds) == len(mounts),
                 'data_only_bindings')
            binds = [str(self.generation) + ':' + GENERATION_MOUNT + ':ro' if item == old_bind else item for item in retained_binds]
        else:
            env.update(AVTOCENA_RELEASE_SHA=self.plan['runtimeSha'], AVTOCENA_BUILD_CALCULATION_VERSION=generation['calculationVersion'],
                       CATALOG_CHINA_LOCAL_GENERATION_DIR=GENERATION_MOUNT,
                       CATALOG_CHINA_LOCAL_MANIFEST_SHA256=self.plan['generationManifestSha256'],
                       CATALOG_CHINA_LOCAL_RUNTIME_SHA=self.plan['pricingRuntimeSha'],
                       CATALOG_HOME_PHASE_TIMING='1', CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS='1800')
            candidate_env = [key + '=' + value for key, value in sorted(env.items())]
            binds = [row['Source'] + ':' + row['Destination'] + ':ro' for row in mounts]
            need(not any(row['Destination'] == GENERATION_MOUNT for row in mounts), 'generation_mount_collision')
            binds.append(str(self.generation) + ':' + GENERATION_MOUNT + ':ro')
        self.spec = {'Image': self.plan['imageId'], 'WorkingDir': '/app',
                     'Entrypoint': copy.deepcopy(self.retained['Config']['Entrypoint']),
                     'Cmd': copy.deepcopy(self.retained['Config']['Cmd']),
                     'Env': candidate_env,
                     'Labels': {'avtocena.application': 'web', 'avtocena.role': 'independent-china',
                                'org.opencontainers.image.revision': self.plan['runtimeSha'], 'avtocena.china.nonce': self.plan['nonce']},
                     'ExposedPorts': {'3000/tcp': {}},
                     'HostConfig': {'Privileged': False, 'NetworkMode': 'bridge', 'Binds': binds,
                                    'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(self.port)}]},
                                    'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}}}
        self.guard()
        name = 'avtocena-china-next-' + self.plan['runtimeSha'][:12] + '-' + self.plan['nonce'][:8]
        created = docker('POST', '/containers/create?name=' + name, self.spec)
        self.candidate = created.get('Id')
        need(re.fullmatch(r'[a-f0-9]{64}', self.candidate or ''), 'candidate_identity')
        docker('POST', '/containers/' + self.candidate + '/start')
        self.wait_startup()
        self.verify_candidate()
        return {'started': True, 'release': self.plan['runtimeSha'], 'generationId': self.plan['generationId'],
                'startup': self.startup_report, 'retainedMountOrderVariations': self.retained_mount_order_variations,
                **({'codeGenerationCopy': self.code_generation_copy} if code_update(self.plan) else {})}

    def wait_startup(self):
        started = time.monotonic()
        deadline = started + 900
        attempts = 0
        category = 'not_checked'
        candidate = None
        def finish(reason):
            self.startup_report = {'version': 1, 'kind': 'china-host-startup-v1', 'ready': reason == 'ready',
                                   'elapsedSeconds': round(time.monotonic() - started, 4), 'attempts': attempts,
                                   'health': category, 'candidate': candidate, 'reason': reason}
            # Persist and transmit safe metadata before cleanup can remove the
            # process. No environment, log text, card or supplier data is kept.
            new_file(self.directory / 'STARTUP.json', json_bytes(self.startup_report))
            fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(fd)
            finally: os.close(fd)
        while True:
            try:
                row = docker('GET', '/containers/' + self.candidate + '/json')
                state = row.get('State', {})
                need(row.get('Id') == self.candidate and row.get('Image') == self.plan['imageId'] and
                     row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') == self.plan['nonce'] and
                     type(state.get('Running')) is bool and type(state.get('OOMKilled')) is bool and
                     type(state.get('ExitCode')) is int and type(row.get('RestartCount')) is int and
                     state.get('Status') in {'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'},
                     'candidate_changed')
                candidate = {'running': state['Running'], 'status': state['Status'], 'exitCode': state['ExitCode'],
                             'oomKilled': state['OOMKilled'], 'restartCount': row['RestartCount']}
            except Exception:
                finish('inspect_unavailable')
                raise ReleaseError('china_host_candidate_inspection') from None
            if candidate['oomKilled']:
                finish('oom')
                raise ReleaseError('china_host_candidate_oom')
            if not candidate['running']:
                finish('exited')
                raise ReleaseError('china_host_candidate_exited')
            if candidate['restartCount'] != 0:
                finish('restarted')
                raise ReleaseError('china_host_candidate_restarted')
            attempts += 1
            ready = False
            try:
                health(self.port, self.plan['runtimeSha'])
                ready = True
            except ConnectionRefusedError:
                category = 'connection_refused'
            except (TimeoutError, socket.timeout):
                category = 'timeout'
            except json.JSONDecodeError:
                category = 'invalid_json'
            except ReleaseError as error:
                category = {'china_host_health_identity': 'identity_mismatch', 'china_host_http_response': 'http_response'}.get(str(error), 'unavailable')
            except OSError:
                category = 'connection_error'
            except Exception:
                category = 'unavailable'
            if ready:
                category = 'ok'
                finish('ready')
                return
            if time.monotonic() >= deadline:
                finish('timeout')
                raise ReleaseError('china_host_candidate_startup') from None
            time.sleep(max(0, min(1, deadline - time.monotonic())))

    def verify_candidate(self):
        self.guard()
        row = docker('GET', '/containers/' + self.candidate + '/json')
        need(row['Id'] == self.candidate and row['Image'] == self.plan['imageId'] and row['State']['Running'] and
             row['RestartCount'] == 0 and row['Config']['Env'] == self.spec['Env'] and row['Config']['Cmd'] == self.spec['Cmd'] and
             row['Config']['Entrypoint'] == self.spec['Entrypoint'] and row['HostConfig']['Binds'] == self.spec['HostConfig']['Binds'] and
             row['HostConfig']['PortBindings'] == self.spec['HostConfig']['PortBindings'] and not row['HostConfig']['Privileged'] and
             row['HostConfig']['RestartPolicy']['Name'] == self.restart, 'candidate_changed')
        health(self.port, self.plan['runtimeSha'])

    def functional(self):
        self.verify_candidate()
        oracle = json.loads((self.directory / 'acceptance.json').read_bytes())
        need(oracle.get('version') == 1 and oracle.get('runtimeSha') == self.plan['runtimeSha'] and
             oracle.get('generationManifestSha256') == self.plan['generationManifestSha256'], 'oracle_identity')
        checked = []
        for case in oracle['cases']:
            need(case['path'].startswith('/api/catalog/search?') and 'market=china' in case['path'], 'oracle_route')
            started = time.monotonic()
            value = response_json(self.port, case['path'])
            need(value.get('ok') is not False and not any(value.get(key) for key in ('partial', 'stale', 'interrupted', 'countIncomplete')),
                 'incomplete_search')
            need(value.get('total') == case['total'] and [row['id'] for row in value.get('items', [])] == case['ids'], 'search_oracle')
            need([row.get('totalRub') for row in value['items']] == case['totalRub'], 'price_oracle')
            checked.append({'name': case['name'], 'total': case['total'], 'items': len(case['ids']),
                            'seconds': round(time.monotonic() - started, 4)})
        need(len(checked) >= 8, 'oracle_coverage')
        self.functional_passed = True
        return {'functionalPassed': True, 'cases': checked}

    def save_home_timing(self, since):
        self.home_phase_timing = None
        env = getattr(self, 'spec', {}).get('Env', [])
        if 'CATALOG_HOME_PHASE_TIMING=1' not in env or 'CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS=1800' not in env:
            return
        try:
            value = capture_home_timing(self.candidate, since, self.plan)
            if value is not None:
                new_file(self.directory / 'HOME_PHASE_TIMING.json', json_bytes(value))
                self.home_phase_timing = value
        except ReleaseError:
            # Cancellation still enters the existing rollback path.
            raise
        except Exception:
            # Optional diagnostics cannot replace a gate failure or make a
            # failed gate successful. Raw Docker/error text is never emitted.
            pass

    def speed(self):
        self.verify_candidate()
        if japan_observed_timing(self.plan):
            # Owner-authorized Japan policy: measure actual health, without
            # replaying unrelated home/China latency benchmarks. Readiness and
            # the immutable retained-data oracle remain functional gates.
            need(self.functional_passed, 'timing_before_functional')
            started = time.monotonic()
            health(self.port, self.plan['runtimeSha'])
            report = {'version': 1, 'kind': 'japan-server-timing-observation-v1',
                      'release': self.plan['runtimeSha'], 'nonce': self.plan['nonce'],
                      'timingPolicy': JAPAN_OBSERVED_TIMING_POLICY, 'speedGateRequired': False,
                      'speedPassed': None, 'timingObserved': True, 'broadServerBenchmarkExecuted': False,
                      'healthSeconds': round(time.monotonic() - started, 4),
                      'baselineSha256': '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'}
            new_file(self.directory / 'SERVER_TIMING.json', json_bytes(report))
            self.timing_observed = True
            return report
        # Reuse the unchanged accepted baseline and its complete warm/expired
        # response checks, scoped to China and shared integrity routes.
        env = {'PATH': '/usr/bin:/bin', 'AVTOCENA_RELEASE_MARKETS': 'china', 'AVTOCENA_SPEED_BASELINE_MODE': 'enforce',
               'AVTOCENA_SPEED_BASELINE': str(self.directory / 'accepted-speed-baseline.json')}
        since = int(time.time())
        try:
            process = subprocess.run(['/usr/bin/python3', '-I', '-B', str(self.directory / 'regcloud-performance-gate.py'),
                                      'http://127.0.0.1:' + str(self.port), self.plan['runtimeSha']],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=1500)
        finally:
            self.save_home_timing(since)
        rows = []
        for line in process.stdout.splitlines():
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    rows.append(value)
            except ValueError:
                pass
        new_file(self.directory / 'server-speed-result.json', json_bytes({'exitCode': process.returncode, 'samples': rows}))
        need(process.returncode == 0, 'server_speed_failed')
        self.verify_candidate()
        self.speed_passed = True
        return {'speedPassed': True, 'samples': rows,
                **({'homePhaseTiming': self.home_phase_timing} if self.home_phase_timing is not None else {})}

    def replace_config(self, expected, wanted):
        regular(CONFIG, 1024 * 1024)
        need(CONFIG.read_bytes() == expected, 'ingress_compare_failed')
        old_stat = CONFIG.stat()
        temporary = CONFIG.with_name(CONFIG.name + '.china-' + self.plan['nonce'])
        new_file(temporary, wanted, stat.S_IMODE(old_stat.st_mode))
        need(CONFIG.read_bytes() == expected, 'ingress_compare_failed')
        os.replace(temporary, CONFIG)
        command(['/usr/sbin/nginx', '-t'])
        command(['/usr/bin/systemctl', 'reload', 'nginx'])

    def switch(self):
        if japan_observed_timing(self.plan):
            need(self.functional_passed and self.timing_observed and not self.switched and not self.accepted, 'switch_before_checks')
        else:
            need(self.functional_passed and self.speed_passed and not self.switched and not self.accepted, 'switch_before_checks')
        self.verify_candidate()
        needle = b'proxy_pass http://127.0.0.1:' + str(self.old_port).encode() + b';'
        need(self.original.count(needle) == 1, 'ingress_replace_scope')
        self.proposed = self.original.replace(needle, b'proxy_pass http://127.0.0.1:' + str(self.port).encode() + b';')
        # Mark before the mutation so a failed validation/reload still restores.
        self.switched = True
        self.verdict_deadline = time.monotonic() + 900
        self.replace_config(self.original, self.proposed)
        self.verify_candidate()
        return {'switched': True, 'nonce': self.plan['nonce'], 'release': self.plan['runtimeSha']}

    def accept(self, verdict):
        if japan_observed_timing(self.plan):
            need(self.switched and self.functional_passed and self.timing_observed and not self.accepted, 'accept_before_switch')
        else:
            need(self.switched and self.functional_passed and self.speed_passed and not self.accepted, 'accept_before_switch')
        need(self.verdict_deadline is not None and time.monotonic() <= self.verdict_deadline, 'browser_deadline')
        self.verify_candidate()
        need(verdict.get('release') == self.plan['runtimeSha'] and verdict.get('nonce') == self.plan['nonce'] and
             verdict.get('countAcceptance') == self.plan.get('countAcceptance') and
             ('countAcceptance' in verdict) == ('countAcceptance' in self.plan) and
             verdict.get('passed') is True and verdict.get('functionalPassed') is True and
             (observed_timing_fields(verdict) if japan_observed_timing(self.plan) else verdict.get('speedPassed') is True) and
             all(re.fullmatch(r'[a-f0-9]{64}', verdict.get(key, '')) for key in
                 ('reportSha256', 'speedReportSha256', 'detailsReportSha256')), 'browser_verdict')
        reports = []
        for name, field in [('BROWSER_SPEED.json', 'speedReportSha256'), ('BROWSER_DETAILS.json', 'detailsReportSha256')]:
            regular(self.directory / name, 256 * 1024)
            raw = (self.directory / name).read_bytes()
            need(sha(raw) == verdict[field], 'browser_evidence_hash')
            reports.append(raw)
        need(sha(b''.join(reports)) == verdict['reportSha256'], 'browser_evidence_hash')
        docker('POST', '/containers/' + self.candidate + '/update', {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}})
        self.restart = 'unless-stopped'
        self.verify_candidate()
        generation_bytes = (self.generation / 'GENERATION.json').read_bytes()
        need(sha(generation_bytes) == self.plan['generationManifestSha256'], 'accepted_generation_changed')
        generation = json.loads(generation_bytes)
        accepted_at = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
        proof = {'version': 1, 'kind': 'china-host-acceptance-v1', 'release': self.plan['runtimeSha'],
                 'generationId': self.plan['generationId'], 'generationManifestSha256': self.plan['generationManifestSha256'],
                 'privateGenerationReceiptSha256': self.plan['privateGenerationReceiptSha256'],
                 'sourceDescriptorSha256': self.plan['sourceDescriptorSha256'], 'imageId': self.plan['imageId'],
                 'pricingRuntimeSha': generation['runtimeSha'], 'sourceCursor': generation['source']['cursor'], 'sourceObservedAt': generation['source']['sourceObservedAt'],
                 'nonce': self.plan['nonce'], 'browser': verdict, 'acceptedAt': accepted_at, 'retainedContainerId': self.retained['Id']}
        if code_update(self.plan):
            proof.update(transition='code-update', previousAcceptedETag=self.plan['previousAcceptedETag'],
                         previousAcceptedStateSha256=self.plan['previousAcceptedStateSha256'],
                         retainedRuntimeSha=retained_runtime(self.plan), retainedImageId=self.retained['Image'])
        if japan_observed_timing(self.plan):
            proof.update(acceptancePolicy=JAPAN_OBSERVED_TIMING_POLICY, codeScope=JAPAN_STABILITY_CODE_SCOPE)
        if self.plan.get('countAcceptance') in (JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY, JAPAN_SOURCE_COUNT_POLICY):
            proof.update(countAcceptance=self.plan['countAcceptance'])
        encoded = json_bytes(proof)
        # The durable receipt is the commit point, including when SSH closes
        # immediately after the atomic rename. No partial terminal receipt is
        # visible, and deferred cancellation runs only after accepted is set.
        self.acceptance_receipt_sha = sha(encoded)
        pending = self.directory / 'ACCEPTED.pending'
        terminal = self.directory / 'ACCEPTED.json'
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGHUP, signal.SIGALRM})
        try:
            need(not terminal.exists() and not (self.directory / 'ROLLED_BACK.json').exists(), 'acceptance_terminal_exists')
            new_file(pending, encoded)
            os.replace(pending, terminal)
            self.accepted = True
            directory_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
        return {'accepted': True, 'release': self.plan['runtimeSha'], 'pricingRuntimeSha': self.plan['pricingRuntimeSha'], 'generationId': self.plan['generationId'],
                'generationManifestSha256': self.plan['generationManifestSha256'], 'sourceDescriptorSha256': self.plan['sourceDescriptorSha256'],
                'privateGenerationReceiptSha256': self.plan['privateGenerationReceiptSha256'], 'imageId': self.plan['imageId'],
                'hostReceiptSha256': sha(encoded), 'hostReceiptBase64': base64.b64encode(encoded).decode(),
                'acceptedAt': accepted_at, 'nonce': self.plan['nonce'],
                'browserReportSha256': verdict['reportSha256'],
                'encyclopediaWrites': 0, 'otherMarketWrites': 0, 'retainedRuntime': retained_runtime(self.plan)}

    def browser_evidence(self, params):
        need(self.switched and not self.accepted and self.verdict_deadline is not None and
             time.monotonic() <= self.verdict_deadline, 'browser_evidence_phase')
        self.verify_candidate()
        speed_raw, speed = decode_report(params.get('speedBase64'))
        details_raw, details = decode_report(params.get('detailsBase64'))
        observed = japan_observed_timing(self.plan)
        timing_bound = (observed_timing_fields(speed) and speed.get('kind') == 'catalog-japan-browser-v1'
                        and speed.get('nonce') == self.plan['nonce']) if observed else \
            (speed.get('browserPassed') is True and speed.get('speedGuard', {}).get('passed') is True)
        need(speed.get('release') == self.plan['runtimeSha'] and speed.get('passed') is True and timing_bound and
             all(value.get('countAcceptance') == self.plan.get('countAcceptance') and
                 ('countAcceptance' in value) == ('countAcceptance' in self.plan) for value in (speed, details)) and
             details.get('kind') == ('japan-code-browser-details-v1' if observed else 'china-browser-details-v1') and
             details.get('passed') is True and
             details.get('release') == self.plan['runtimeSha'] and details.get('nonce') == self.plan['nonce'] and
             details.get('generationManifestSha256') == self.plan['generationManifestSha256'] and
             details.get('precedingSpeedReportSha256') == sha(speed_raw), 'browser_evidence_binding')
        if observed:
            need(observed_timing_fields(details) and details.get('retainedChinaOraclePassed') is True
                 and details.get('unrelatedBrowserBenchmarksExecuted') is False,
                 'japan_observed_timing_binding')
            regular(self.directory / 'SERVER_TIMING.json', 16 * 1024)
            need(details.get('serverTiming') == json.loads((self.directory / 'SERVER_TIMING.json').read_bytes()),
                 'japan_server_timing_binding')
        if not observed and code_update(self.plan) and code_scope(self.plan) in (CRM_CHINA_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_SCOPE, JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE):
            need(isinstance(details.get('crmChinaReportBase64'), str) and
                 isinstance(details.get('crmChinaReportSha256'), str) and
                 re.fullmatch(r'[a-f0-9]{64}', details['crmChinaReportSha256']), 'crm_browser_binding')
            crm_raw, crm = decode_report(details['crmChinaReportBase64'])
            oracle_sha = next(row['sha256'] for row in self.plan['files'] if row['name'] == 'acceptance.json')
            manifest_file = self.generation / 'GENERATION.json'
            regular(manifest_file, 256 * 1024)
            manifest_raw = manifest_file.read_bytes()
            need(sha(manifest_raw) == self.plan['generationManifestSha256'], 'crm_manifest_binding')
            manifest = json.loads(manifest_raw)
            need(set(crm) == {'version', 'kind', 'codeScope', 'release', 'nonce', 'checkedAt', 'pricingRuntimeSha',
                 'generationManifestSha256', 'generationId', 'sourceObservedAt', 'rows', 'oracleSha256', 'passed',
                 'manifestHelperPassed', 'middlewareBoundaryPassed', 'unauthorizedStatus', 'unauthorizedContentTypeJson',
                 'unauthorizedBodyIsAuthRequired', 'unauthorizedSetCookieAbsent',
                 'unsignedAccessDenied', 'productionMutations', 'directSupplierRequests', 'signedInRequests'} and
                 len(crm_raw) <= 16 * 1024 and sha(crm_raw) == details['crmChinaReportSha256'] and
                 type(crm.get('version')) is int and crm['version'] == 1 and crm.get('kind') == 'china-crm-operations-proof-v1' and
                 crm.get('codeScope') == code_scope(self.plan) and crm.get('release') == self.plan['runtimeSha'] and
                 crm.get('nonce') == self.plan['nonce'] and crm.get('pricingRuntimeSha') == self.plan['pricingRuntimeSha'] and
                 crm.get('generationManifestSha256') == self.plan['generationManifestSha256'] and
                 crm.get('generationId') == self.plan['generationId'] == manifest.get('generationId') and
                 crm.get('sourceObservedAt') == manifest.get('source', {}).get('sourceObservedAt') ==
                    self.plan['previousAcceptedState']['current']['sourceObservedAt'] and
                 type(crm.get('rows')) is int and crm['rows'] > 0 and crm['rows'] == manifest.get('rows') and
                 crm.get('oracleSha256') == oracle_sha and
                 isinstance(crm.get('checkedAt'), str) and
                 re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', crm['checkedAt']) and
                 all(crm.get(key) is True for key in ('passed', 'manifestHelperPassed', 'middlewareBoundaryPassed',
                     'unauthorizedContentTypeJson', 'unauthorizedBodyIsAuthRequired', 'unauthorizedSetCookieAbsent', 'unsignedAccessDenied')) and
                 type(crm.get('unauthorizedStatus')) is int and crm['unauthorizedStatus'] == 401 and
                 all(type(crm.get(key)) is int and crm[key] == 0 for key in
                     ('productionMutations', 'directSupplierRequests', 'signedInRequests')), 'crm_browser_binding')
        if code_update(self.plan) and code_scope(self.plan) in (CRM_JAPAN_PHOTO_CODE_SCOPE, JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE):
            oracle_sha = next(row['sha256'] for row in self.plan['files'] if row['name'] == 'acceptance.json')
            need(isinstance(details.get('japanPhotoRetryReportBase64'), str) and
                 isinstance(details.get('japanPhotoRetryReportSha256'), str) and
                 re.fullmatch(r'[a-f0-9]{64}', details['japanPhotoRetryReportSha256']), 'japan_photo_retry_binding')
            retry_raw, retry = decode_report(details['japanPhotoRetryReportBase64'])
            need(0 < len(retry_raw) <= 32 * 1024 and sha(retry_raw) == details['japanPhotoRetryReportSha256'] and
                 set(retry) == {'version', 'kind', 'codeScope', 'release', 'nonce', 'checkedAt', 'oracleSha256',
                                'fixtureBase64', 'fixtureSha256', 'passed', 'directSupplierRequests', 'productionMutations'} and
                 type(retry.get('version')) is int and retry['version'] == 1 and
                 retry.get('kind') == 'japan-photo-retry-proof-v1' and
                 retry.get('codeScope') == code_scope(self.plan) and
                 retry.get('release') == self.plan['runtimeSha'] and retry.get('nonce') == self.plan['nonce'] and
                 retry.get('oracleSha256') == oracle_sha and retry.get('passed') is True and
                 all(type(retry.get(key)) is int and retry[key] == 0 for key in
                     ('directSupplierRequests', 'productionMutations')) and
                 isinstance(retry.get('checkedAt'), str) and
                 re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', retry['checkedAt']) and
                 isinstance(retry.get('fixtureSha256'), str) and
                 re.fullmatch(r'[a-f0-9]{64}', retry['fixtureSha256']), 'japan_photo_retry_binding')
            try:
                timestamp = datetime.datetime.fromisoformat(retry['checkedAt'].replace('Z', '+00:00'))
                need(timestamp.isoformat(timespec='milliseconds').replace('+00:00', 'Z') == retry['checkedAt'],
                     'japan_photo_retry_date')
            except (ValueError, TypeError):
                need(False, 'japan_photo_retry_date')
            fixture_raw, fixture = decode_report(retry.get('fixtureBase64'))
            checks = {'transientRecovery', 'persistentFailureBound', 'sourceChangeCancellation',
                      'unmountCancellation', 'exactUrl', 'noExternalRequests',
                      'protectedPhotoPreserved', 'lazyLoadRecovery'}
            need(0 < len(fixture_raw) <= 16 * 1024 and sha(fixture_raw) == retry['fixtureSha256'] and
                 set(fixture) == {'version', 'kind', 'passed', 'widths', 'caseCount', 'checks'} and
                 type(fixture.get('version')) is int and fixture['version'] == 1 and
                 fixture.get('kind') == 'japan-photo-retry-browser-v1' and fixture.get('passed') is True and
                 fixture.get('widths') == [1440, 390] and
                 type(fixture.get('caseCount')) is int and fixture['caseCount'] == 12 and
                 isinstance(fixture.get('checks'), dict) and set(fixture['checks']) == checks and
                 all(fixture['checks'][key] is True for key in checks), 'japan_photo_retry_fixture')
        if code_update(self.plan) and code_scope(self.plan) == PHOTO_CODE_SCOPE:
            need(isinstance(details.get('photoReportBase64'), str) and
                 isinstance(details.get('photoReportSha256'), str) and
                 re.fullmatch(r'[a-f0-9]{64}', details['photoReportSha256']), 'photo_browser_binding')
            photo_raw, photo = decode_report(details['photoReportBase64'])
            oracle_sha = next(row['sha256'] for row in self.plan['files'] if row['name'] == 'acceptance.json')
            need(len(photo_raw) <= 128 * 1024 and sha(photo_raw) == details['photoReportSha256'] and
                 photo.get('version') == 1 and photo.get('kind') == 'china-photo-browser-v1' and
                 photo.get('codeScope') == PHOTO_CODE_SCOPE and
                 photo.get('release') == self.plan['runtimeSha'] and photo.get('nonce') == self.plan['nonce'] and
                 photo.get('generationManifestSha256') == self.plan['generationManifestSha256'] and
                 photo.get('oracleSha256') == oracle_sha and photo.get('passed') is True and
                 photo.get('chinaPhotoPassed') is True and photo.get('readOnlyBrowserFence') is True and
                 all(type(photo.get(key)) is int and photo[key] == 0 for key in
                     ('productionMutations', 'directSupplierRequests', 'explicitJapanApiRequests', 'japanUiNavigations')),
                 'photo_browser_binding')
        if code_update(self.plan) and code_scope(self.plan) == PHOTO_JAPAN_CODE_SCOPE:
            need(isinstance(details.get('photoJapanReportBase64'), str) and
                 isinstance(details.get('photoJapanReportSha256'), str) and
                 re.fullmatch(r'[a-f0-9]{64}', details['photoJapanReportSha256']), 'photo_japan_browser_binding')
            photo_raw, photo = decode_report(details['photoJapanReportBase64'])
            oracle_sha = next(row['sha256'] for row in self.plan['files'] if row['name'] == 'acceptance.json')
            need(sha(photo_raw) == details['photoJapanReportSha256'] and
                 photo.get('version') == 1 and photo.get('kind') == 'china-photo-japan-browser-v1' and
                 photo.get('release') == self.plan['runtimeSha'] and photo.get('nonce') == self.plan['nonce'] and
                 photo.get('generationManifestSha256') == self.plan['generationManifestSha256'] and
                 photo.get('oracleSha256') == oracle_sha and
                 all(photo.get(key) is True for key in ('passed', 'chinaPhotoPassed', 'japanFreshnessPassed',
                                                       'japanPowerApiPassed', 'japanUiPassed')),
                 'photo_japan_browser_binding')
        if code_update(self.plan) and code_scope(self.plan) in (JAPAN_CODE_SCOPE, JAPAN_COMPLETION_CODE_SCOPE, JAPAN_COMPLETION_V2_CODE_SCOPE, JAPAN_USABILITY_CODE_SCOPE, JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE):
            # This session's nonce and the live browser deadline above bind
            # freshness without assuming the runner and host clocks are equal.
            need(isinstance(details.get('japanReportBase64'), str) and
                 isinstance(details.get('japanReportSha256'), str) and
                 re.fullmatch(r'[a-f0-9]{64}', details['japanReportSha256']), 'japan_browser_binding')
            japan_raw, japan = decode_report(details['japanReportBase64'])
            oracle_sha = next(row['sha256'] for row in self.plan['files'] if row['name'] == 'acceptance.json')
            need(len(japan_raw) <= 128 * 1024 and sha(japan_raw) == details['japanReportSha256'] and
                 type(japan.get('version')) is int and japan['version'] == 1 and japan.get('kind') == 'catalog-japan-browser-v1' and
                 japan.get('codeScope') == code_scope(self.plan) and
                 japan.get('release') == self.plan['runtimeSha'] and japan.get('nonce') == self.plan['nonce'] and
                 japan.get('generationManifestSha256') == self.plan['generationManifestSha256'] and
                 japan.get('oracleSha256') == oracle_sha and
                 all(japan.get(key) is True for key in ('passed', 'japanFreshnessPassed', 'japanPowerApiPassed',
                                                       'japanUiPassed', 'japanVisibilityPassed', 'readOnlyBrowserFence')) and
                 all(type(japan.get(key)) is int and japan[key] == 0 for key in
                     ('productionMutations', 'directSupplierApiRequests')), 'japan_browser_binding')
            if observed:
                need(japan_raw == speed_raw and observed_timing_fields(japan), 'japan_observed_timing_binding')
            if code_scope(self.plan) in (JAPAN_COMPLETION_CODE_SCOPE, JAPAN_COMPLETION_V2_CODE_SCOPE, JAPAN_USABILITY_CODE_SCOPE, JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE):
                need(all(japan.get(key) is True for key in ('japanPetrolPowerUiPassed', 'japanDetailPowerInputPassed',
                                                          'japanDeliveredCalculationPassed')) and
                     type(japan.get('japanPreviewCalculationRequests')) is int and
                     1 <= japan['japanPreviewCalculationRequests'] <= 2, 'japan_browser_binding')
            if code_scope(self.plan) == JAPAN_USABILITY_CODE_SCOPE:
                need(all(japan.get(key) is True for key in ('japanBrandDirectoryPassed', 'japanFullPagesPassed',
                     'japanKnownPowerOrderPassed', 'japanVehiclePolicyPassed', 'japanQuietCatalogPassed')), 'japan_browser_binding')
            if code_scope(self.plan) in (JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE):
                need(all(japan.get(key) is True for key in ('japanFullPagesPassed', 'japanPagination24Passed', 'japanCatalogWarningRemovedPassed')),
                     'japan_browser_binding')
            if code_scope(self.plan) == JAPAN_STABILITY_CODE_SCOPE:
                need(all(japan.get(key) is True for key in ('japanModelSelectionPassed', 'japanCombinedFiltersPassed',
                     'japanRelatedCardsPassed', 'japanVehiclePolicyPassed')), 'japan_browser_binding')
                # Bind the stronger live cursor/order proof to this exact
                # already-verified image manifest, never to a report's claim.
                image_descriptor = next(row for row in self.plan['files'] if row['name'] == 'image-receipt.json')
                regular(self.directory / 'image-receipt.json', 256 * 1024)
                image_raw = (self.directory / 'image-receipt.json').read_bytes()
                need(len(image_raw) == image_descriptor['bytes'] and sha(image_raw) == image_descriptor['sha256'],
                     'code_image_receipt_hash')
                image = json.loads(image_raw)
                need(image.get('countAcceptance') == self.plan.get('countAcceptance')
                     and ('countAcceptance' in image) == ('countAcceptance' in self.plan), 'count_acceptance_image_binding')
                runtime_profile = checked_japan_stability_image_files(image.get('runtimeFiles'), observed,
                    self.plan.get('retainedRuntime'), self.plan.get('countAcceptance'))
                if runtime_profile in (JAPAN_STABILITY_POWER_CODE_FILES, JAPAN_STABILITY_RAILS_CODE_FILES,
                                       JAPAN_STABILITY_HOME_CODE_FILES, JAPAN_STABILITY_METADATA_CODE_FILES,
                                       JAPAN_STABILITY_PRICE_SORT_CODE_FILES, JAPAN_STABILITY_EXACT_COUNT_CODE_FILES,
                                       JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES, JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES):
                    need(japan.get('japanPowerOrderPassed') is True, 'japan_browser_binding')
                if runtime_profile in (JAPAN_STABILITY_RAILS_CODE_FILES, JAPAN_STABILITY_HOME_CODE_FILES,
                                       JAPAN_STABILITY_METADATA_CODE_FILES, JAPAN_STABILITY_PRICE_SORT_CODE_FILES, JAPAN_STABILITY_EXACT_COUNT_CODE_FILES,
                                       JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES, JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES):
                    need(japan.get('japanBrandDirectoryPassed') is True, 'japan_browser_binding')
                if runtime_profile in (JAPAN_STABILITY_PRICE_SORT_CODE_FILES, JAPAN_STABILITY_EXACT_COUNT_CODE_FILES,
                                       JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES, JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES):
                    need(all(japan.get(key) is True for key in ('japanPriceSortRequired', 'japanPriceSortPassed', 'japanCountDisplayPassed')),
                         'japan_browser_binding')
                if runtime_profile == JAPAN_STABILITY_EXACT_COUNT_CODE_FILES:
                    if self.plan.get('countAcceptance') == JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY:
                        need(japan_source_bounded_acceptance_passed(japan), 'japan_browser_binding')
                    else:
                        need(all(japan.get(key) is True for key in ('japanExactCountRequired', 'japanExactCountPassed', 'japanModelCoveragePassed')),
                             'japan_browser_binding')
                if runtime_profile in (JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES, JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES):
                    need(japan_source_count_acceptance_passed(japan), 'japan_browser_binding')
                if runtime_profile == JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES:
                    need(japan_a4_power160_continuation_acceptance_passed(japan), 'japan_browser_binding')
        for name, raw in [('BROWSER_SPEED.json', speed_raw), ('BROWSER_DETAILS.json', details_raw)]:
            new_file(self.directory / name, raw)
            need(file_sha(self.directory / name) == sha(raw), 'browser_evidence_readback')
        return {'saved': True, 'speedReportSha256': sha(speed_raw), 'detailsReportSha256': sha(details_raw)}

    def retire(self, params):
        """After the private accepted-state CAS, retire only the former rollback
        process and its verified bulk files. Preserve historical proofs/images."""
        need(accepted_update(self.plan) and self.accepted, 'retire_before_acceptance')
        self.verify_candidate()
        state = params.get('acceptedState')
        need(isinstance(state, dict) and state.get('version') == 1 and state.get('market') == 'china' and
             state.get('kind') == 'china-accepted-state-v1' and state.get('pending') is None and
             type(state.get('revision')) is int and state['revision'] == self.plan['previousAcceptedState']['revision'] + 2,
             'retire_state')
        need(canonical_sha(state) == params.get('acceptedStateSha256') and
             isinstance(params.get('acceptedETag'), str) and
             re.fullmatch(r'"[^"\x00-\x20\x7f]{1,250}"', params['acceptedETag']) and
             params['acceptedETag'] != self.plan['previousAcceptedETag'], 'retire_state_hash')
        current = state.get('current')
        receipt, raw = accepted_reference_receipt(current)
        terminal = self.directory / 'ACCEPTED.json'
        regular(terminal, 256 * 1024)
        commit = state.get('commit')
        need(raw == terminal.read_bytes() and receipt['nonce'] == self.plan['nonce'] and
             current['generationId'] == self.plan['generationId'] and isinstance(commit, dict) and
             commit.get('nonce') == self.plan['nonce'] and commit.get('acceptedAt') == receipt.get('acceptedAt') and
             commit.get('previousETag') == self.plan['previousAcceptedETag'] and
             commit.get('previousStateSha256') == self.plan['previousAcceptedStateSha256'] and
             state.get('rollback') == self.plan['previousAcceptedState']['current'], 'retire_commit')
        verify_live_reference(current, self.plan['nonce'])
        return retire_reference(self.plan['previousAcceptedState'].get('rollback'), [state['current'], state['rollback']],
                                {self.candidate, self.retained['Id']}, self.verify_candidate)

    def cleanup_failed_code_files(self):
        """Remove only this never-accepted code attempt's verified local copies.

        The caller still owns the runtime lock and has restored the retained
        application. Historical proofs, manifests, images in Docker and every
        current/rollback deployment are preserved. This is not a general GC.
        """
        need(code_update(self.plan) and not self.accepted and not self.switched and self.candidate is None
             and self.lock is not None and self.retained is not None, 'code_cleanup_phase')
        plan, plan_raw = diagnosis_json(self.directory / 'PLAN.json')
        need(plan == self.plan, 'code_cleanup_plan')
        validate_plan(plan)
        previous, previous_receipt, _ = accepted_predecessor(plan)
        protected = [value for value in (plan['previousAcceptedState'].get('current'),
                                        plan['previousAcceptedState'].get('rollback')) if value is not None]
        need((plan['runtimeSha'], plan['nonce']) not in {deployment_identity(value) for value in protected},
             'code_cleanup_protected')
        for value in protected:
            verified_history(value)
        rollback, rollback_raw = diagnosis_json(self.directory / 'ROLLED_BACK.json')
        bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha',
                    'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                    'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256',
                    'sourceDescriptorSha256': 'sourceDescriptorSha256', 'imageId': 'imageId',
                    'previousAcceptedETag': 'previousAcceptedETag',
                    'previousAcceptedStateSha256': 'previousAcceptedStateSha256'}
        need(rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1'
             and all(rollback.get(left) == plan[right] for left, right in bindings.items())
             and rollback.get('retainedContainerId') == self.retained['Id']
             and rollback.get('retainedImageId') == previous['imageId']
             and rollback.get('retainedRuntimeSha') == previous['runtimeSha']
             and all(rollback.get(key) is True for key in ('retainedRunning', 'ingressRestored', 'candidateRemoved')),
             'code_cleanup_rollback')

        def fence():
            self.guard()
            for parent in (BASE, self.directory.parent.parent, self.directory.parent, self.directory, self.generation):
                private_directory(parent)
            need(not (self.directory / 'ACCEPTED.json').exists() and not (self.directory / 'ACCEPTED.json').is_symlink()
                 and diagnosis_json(self.directory / 'PLAN.json')[1] == plan_raw
                 and diagnosis_json(self.directory / 'ROLLED_BACK.json')[1] == rollback_raw, 'code_cleanup_proof_changed')
            check_mounted_reference(docker('GET', '/containers/' + self.retained['Id'] + '/json'), previous,
                                    previous_receipt['nonce'])
            # Stopped containers also retain bind references and must block
            # deletion. A parent-directory bind protects the whole subtree.
            for row in docker('GET', '/containers/json?all=1'):
                inspected = docker('GET', '/containers/' + row['Id'] + '/json')
                for mount in inspected.get('Mounts', []):
                    source = mount.get('Source')
                    if not source:
                        continue
                    need(isinstance(source, str) and Path(source).is_absolute(), 'code_cleanup_mount_path')
                    mounted = Path(source).resolve()
                    need(mounted != self.directory and mounted not in self.directory.parents
                         and self.directory not in mounted.parents, 'code_cleanup_mounted')

        fence()
        # The rollback directory entry must be durable before deleting any
        # bulk copy; retaining only an fsynced file is insufficient on a crash.
        rollback_directory = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(rollback_directory)
        finally:
            os.close(rollback_directory)
        # Validate every existing target before the first unlink. A partial
        # generation copy is already removed by reuse_copy_file on failure.
        targets = []
        for descriptor in plan['files']:
            if descriptor['name'] not in HOST_BULK_FILES:
                continue
            filename = self.file_path(descriptor['name'])
            try:
                before = regular(filename)
            except FileNotFoundError:
                continue
            need(before.st_size == descriptor['bytes'] and file_sha(filename) == descriptor['sha256'],
                 'code_cleanup_file_hash')
            identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
            need(reuse_file_identity(filename) == identity, 'code_cleanup_file_changed')
            targets.append((filename, identity))
        deleted = freed = 0
        for filename, identity in targets:
            fence()
            need(reuse_file_identity(filename) == identity, 'code_cleanup_file_changed')
            filename.unlink()
            deleted += 1
            freed += identity[2]
        for parent in (self.directory, self.generation):
            descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        fence()
        result = {'version': 1, 'kind': 'china-failed-code-bulk-cleanup-v1', 'runtimeSha': plan['runtimeSha'],
                  'nonce': plan['nonce'], 'planSha256': sha(plan_raw), 'rollbackSha256': sha(rollback_raw),
                  'filesDeleted': deleted, 'logicalBytesDeleted': freed, 'completed': True,
                  'imagesDeleted': 0, 'directoriesDeleted': 0, 'protectedDeploymentsPreserved': True}
        receipt = self.directory / 'FAILED_CODE_CLEANUP.json'
        if not receipt.exists():
            new_file(receipt, json_bytes(result))
            receipt_directory = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(receipt_directory)
            finally:
                os.close(receipt_directory)
        else:
            saved, _ = diagnosis_json(receipt)
            need(deleted == 0 and all(saved.get(key) == result[key] for key in
                 ('version', 'kind', 'runtimeSha', 'nonce', 'planSha256', 'rollbackSha256', 'completed',
                  'imagesDeleted', 'directoriesDeleted', 'protectedDeploymentsPreserved')), 'code_cleanup_receipt_changed')
            result = saved
        self.code_failed_cleanup = result
        return result

    def cleanup(self):
        terminal = self.directory / 'ACCEPTED.json'
        if not self.accepted and terminal.exists():
            # Also covers a non-signal exception after rename and before the
            # in-memory flag. A valid terminal acceptance is never rolled back.
            regular(terminal, 256 * 1024)
            need(getattr(self, 'acceptance_receipt_sha', None) == file_sha(terminal), 'acceptance_terminal_changed')
            self.accepted = True
        if self.accepted:
            return
        if self.switched:
            # Restore only our exact ingress edit; never overwrite a stranger's.
            current = CONFIG.read_bytes()
            if current == self.proposed:
                self.replace_config(self.proposed, self.original)
            else:
                need(current == self.original, 'rollback_ingress_changed')
            health(self.old_port, retained_runtime(self.plan))
            self.switched = False
        if self.candidate:
            row = docker('GET', '/containers/' + self.candidate + '/json')
            need(row['Config']['Labels'].get('avtocena.china.nonce') == self.plan['nonce'], 'cleanup_foreign_container')
            if row['State']['Running']:
                docker('POST', '/containers/' + self.candidate + '/stop?t=10')
            docker('DELETE', '/containers/' + self.candidate + '?v=false&force=false')
            self.candidate = None
        if self.retained is not None and self.original is not None and self.lock is not None and hasattr(self, 'retained_identity'):
            self.guard()
            proof = {'version': 1, 'kind': 'china-host-rollback-v1', 'nonce': self.plan['nonce'],
                     'release': self.plan['runtimeSha'], 'pricingRuntimeSha': self.plan['pricingRuntimeSha'],
                     'generationId': self.plan['generationId'], 'generationManifestSha256': self.plan['generationManifestSha256'],
                     'privateGenerationReceiptSha256': self.plan['privateGenerationReceiptSha256'],
                     'sourceDescriptorSha256': self.plan['sourceDescriptorSha256'], 'imageId': self.plan['imageId'],
                     'previousAcceptedETag': self.plan.get('previousAcceptedETag'),
                     'previousAcceptedStateSha256': self.plan.get('previousAcceptedStateSha256'),
                     'rolledBackAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
                     'retainedContainerId': self.retained['Id'], 'retainedRuntimeSha': retained_runtime(self.plan),
                     'retainedImageId': self.retained['Image'], 'retainedRunning': True,
                     'ingressRestored': True, 'candidateRemoved': True}
            if not (self.directory / 'ROLLED_BACK.json').exists():
                new_file(self.directory / 'ROLLED_BACK.json', json_bytes(proof))
            if code_update(self.plan):
                self.cleanup_failed_code_files()


def main():
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_terminated')))
    signal.signal(signal.SIGHUP, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_disconnected')))
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_browser_deadline')))
    host = None
    host_cleanup_completed = False
    resolved_cleanup = None
    image_cleanup = None
    recovered = maintenance = diagnosed = pruned = witness_pruned = False
    emit({'kind': 'ready', 'protocol': 1})
    try:
        while True:
            if host and host.switched and not host.accepted:
                remaining = host.verdict_deadline - time.monotonic()
                need(remaining > 0, 'browser_deadline')
                signal.setitimer(signal.ITIMER_REAL, remaining)
            try:
                raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
            need(raw and len(raw) <= 1024 * 1024, 'protocol_input')
            call = json.loads(raw)
            identity, method = call['id'], call['method']
            need(type(identity) is int and identity > 0, 'protocol_id')
            need(not diagnosed or method in {'diagnose', 'close'}, 'diagnosis_read_only')
            need(image_cleanup is None or method in {'retire_terminal_app_image', 'close'}, 'app_image_protocol_scope')
            need(not pruned or method in {'prune_failed_uploads', 'close'}, 'prune_protocol_scope')
            need(not witness_pruned or method in {'prune_failed_witness', 'close'}, 'witness_protocol_scope')
            need(resolved_cleanup is None or method in {'prune_resolved_failed_uploads', 'close'}, 'resolved_protocol_scope')
            params = call.get('params', {})
            if method == 'diagnose':
                need(host is None, 'diagnosis_after_init')
                value = diagnose_startup(params)
                recovered = diagnosed = True
            elif method == 'recover':
                need(host is None, 'recovery_after_init')
                value = read_outcome(params)
                recovered = True
            elif method == 'code_preflight':
                need(host is None, 'code_preflight_after_init')
                value = code_preflight(params)
                recovered = True
            elif method == 'retire_recovery':
                need(host is None, 'recovery_after_init')
                value = retire_recovery(params)
                recovered = maintenance = True
            elif method == 'retire_terminal_app_image':
                need(host is None and resolved_cleanup is None and not (diagnosed or pruned or witness_pruned), 'app_image_protocol_scope')
                if image_cleanup is None:
                    need(not recovered, 'app_image_protocol_scope')
                    image_cleanup = TerminalAppImageCleanup(params)
                    value = image_cleanup.prepared()
                else:
                    value = image_cleanup.remove(params)
                recovered = maintenance = True
            elif method == 'prune_failed_uploads':
                need(host is None, 'prune_after_init')
                value = prune_failed_uploads(params)
                recovered = maintenance = pruned = True
            elif method == 'prune_failed_witness':
                need(host is None, 'witness_after_init')
                value = prune_failed_witness(params)
                recovered = maintenance = witness_pruned = True
            elif method == 'prune_resolved_failed_uploads':
                need(host is None and not (diagnosed or pruned or witness_pruned), 'resolved_protocol_scope')
                if resolved_cleanup is None:
                    need(not recovered and isinstance(params, dict) and set(params) == {'action', 'authority'}
                         and params['action'] == 'prepare', 'resolved_prepare')
                    resolved_cleanup = ResolvedFailedUploadCleanup(params['authority'])
                    value = resolved_cleanup.prepared()
                elif params.get('action') == 'unlink':
                    value = resolved_cleanup.step(params)
                else:
                    value = resolved_cleanup.finish(params)
                recovered = maintenance = True
            elif method == 'close' and host is None:
                need(recovered, 'close_uninitialized')
                need(resolved_cleanup is None or resolved_cleanup.finished, 'resolved_close_incomplete')
                need(image_cleanup is None or image_cleanup.finished, 'app_image_close_incomplete')
                emit({'kind': 'result', 'id': identity, 'value': {'closed': True, 'readOnly': not maintenance}})
                return
            elif method == 'resume_init':
                need(host is None, 'already_initialized')
                host, value = resume_failed_upload(params)
            elif method == 'init':
                need(host is None, 'already_initialized')
                host = Host(params['plan'])
                value = {'initialized': True}
                if generation_update(host.plan):
                    value['generationDiskAdmission'] = host.generation_disk_admission
            else:
                need(host is not None, 'not_initialized')
                if method == 'upload':
                    emit({'kind': 'upload-ready', 'id': identity})
                    value = host.upload(params['name'], sys.stdin.buffer)
                elif method == 'start':
                    value = host.start()
                elif method == 'functional':
                    value = host.functional()
                elif method == 'speed':
                    value = host.speed()
                elif method == 'switch':
                    value = host.switch()
                elif method == 'accept':
                    value = host.accept(params['verdict'])
                elif method == 'browser_evidence':
                    value = host.browser_evidence(params)
                elif method == 'retire':
                    value = host.retire(params)
                elif method == 'close':
                    # The controller reconciles immediately after this reply.
                    # Finish rollback and persist its witness before allowing
                    # it to close SSH or read the durable outcome. This reply
                    # is not acceptance evidence; recover still verifies the
                    # exact nonce, retained deployment and rollback receipt.
                    host.cleanup()
                    host_cleanup_completed = True
                    emit({'kind': 'result', 'id': identity, 'value': {'closed': True, 'accepted': host.accepted}})
                    return
                else:
                    raise ReleaseError('china_host_unknown_method')
            emit({'kind': 'result', 'id': identity, 'value': value})
    except BaseException as error:
        # A transport failure may send TERM/HUP immediately after this error.
        # Rollback must finish even when the controller has already gone away.
        signal.setitimer(signal.ITIMER_REAL, 0)
        for cancellation in (signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
            signal.signal(cancellation, signal.SIG_IGN)
        code = str(error) if isinstance(error, ReleaseError) else 'china_host_operation_failed'
        try:
            reply = {'kind': 'error', 'id': locals().get('identity'), 'code': code}
            if locals().get('method') == 'retire_terminal_app_image':
                reply['appImageCleanup'] = image_cleanup.pending() if image_cleanup is not None else {
                    'version': 1, 'kind': 'china-terminal-app-image-cleanup-v1', 'completed': False,
                    'status': 'pending', 'uncertain': False, 'errorCode': 'proof_invalid'}
            if host is not None and hasattr(host, 'startup_report'):
                reply['startup'] = host.startup_report
            if isinstance(error, ReleaseError) and hasattr(error, 'retained_fence'):
                reply['retainedFence'] = error.retained_fence
            if host is not None and locals().get('method') == 'speed':
                if getattr(host, 'home_phase_timing', None) is not None:
                    reply['homePhaseTiming'] = host.home_phase_timing
                try:
                    # Same bounded sanitizer as the read-only diagnosis. A
                    # broken/missing diagnostic must not replace the gate's
                    # original failure or prevent the existing rollback.
                    reply['serverSpeed'] = saved_speed_diagnosis(host.directory, host.plan)
                except Exception:
                    pass
            emit(reply)
        except (BrokenPipeError, OSError):
            pass
        raise
    finally:
        if image_cleanup is not None:
            image_cleanup.close()
        if resolved_cleanup is not None:
            resolved_cleanup.close()
        if host:
            try:
                if not host_cleanup_completed:
                    host.cleanup()
            finally:
                if host.lock is not None:
                    os.close(host.lock)


if __name__ == '__main__':
    main()

