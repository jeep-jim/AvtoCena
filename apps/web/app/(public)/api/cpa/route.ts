import { NextResponse } from "next/server";
import { readDataJson } from "@/lib/data";

export async function GET() {
  const payouts = readDataJson("cpa/payouts.json", { defaultSignedContractPayoutRub: 10000 });

  return NextResponse.json({
    name: "AvtoCena CPA API",
    version: "0.1",
    offer: {
      title: "АвтоЦена — заявка на авто под заказ",
      goal: "signed_contract",
      payoutRub: payouts.defaultSignedContractPayoutRub,
      holdDays: 0
    },
    tracking: {
      landing: "https://avtocena.com/?ref={partner_id}&subid={subid}",
      postback: "https://avtocena.com/api/cpa/postback?secret={secret}&click_id={click_id}&status=signed_contract"
    },
    events: ["visit", "calculation", "lead", "signed_contract", "paid"]
  });
}
