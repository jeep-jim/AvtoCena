import fs from 'node:fs';
import {assertHomeInventoryReceipt} from './acceptance.mjs';
import {sha256} from './contract.mjs';

try {
  if (process.argv.length !== 3) throw Error('home_ui_inventory_receipt_path_required');
  const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  assertHomeInventoryReceipt(receipt);
  console.log(JSON.stringify({stage:'home_ui_inventory_requires_review', inventorySha256:sha256(JSON.stringify(receipt)),
    observedAt:receipt.observedAt, activationAuthorized:false, requiresReviewedRollbackPins:true}));
} catch (error) { console.error(error.message); process.exitCode = 1; }
