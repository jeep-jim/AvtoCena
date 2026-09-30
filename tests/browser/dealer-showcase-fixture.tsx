import React from "react";
import { createRoot } from "react-dom/client";
import { DealerEditor } from "../../apps/web/components/dealers/DealerEditor";
import { SpecialRail } from "../../apps/web/components/dealers/SpecialRail";
import { BuyerGallery } from "../../apps/web/components/home/BuyerGallery";
import { defaultShowcase } from "../../apps/web/lib/dealers/showcase-model";
const s = defaultShowcase("dealer_topavto");
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-6xl p-4 text-white">
    <h1 className="mb-6 text-3xl font-black">TopAvto — витрина дилера</h1>
    <DealerEditor
      initial={s}
      features={{ version: 0, affiliatesEnabled: true }}
    />
    <div className="mt-20">
      <BuyerGallery images={s.buyerPhotos.map((p) => p.url)} />
      <SpecialRail
        heading={s.specialHeading}
        items={[
          {
            id: "rav4",
            href: "#rav4",
            image: "/buyers/1.jpg",
            title: "Toyota RAV4 Premium",
            price: 3135900,
            city: "Новосибирск",
            daysFrom: 5,
            daysTo: 7,
          },
          {
            id: "kia",
            href: "#kia",
            image: "/buyers/2.jpg",
            title: "Kia Sportage X-Line",
            price: null,
            city: "Москва",
          },
        ]}
      />
    </div>
  </main>,
);
