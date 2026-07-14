"use client";

import { useState } from "react";
import { uiLabel } from "@/lib/crm";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function SmallInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="soft-input min-w-0 rounded-xl bg-zinc-950 px-3 py-2.5 text-xs font-bold text-white placeholder:text-white/25"
    />
  );
}

function SmallSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="soft-input min-w-0 rounded-xl bg-zinc-950 px-3 py-2.5 text-xs font-bold text-white placeholder:text-white/25"
    />
  );
}

export function MarketStructuredFields({ version }: { version: any }) {
  const [percentExpenses, setPercentExpenses] = useState<any[]>(
    version.percentExpenses || [],
  );
  const [dealStages, setDealStages] = useState<any[]>(version.dealStages || []);
  const [minMax, setMinMax] = useState(version.minMax || {});

  return (
    <div className="grid gap-4 md:col-span-2 lg:col-span-4">
      <input
        type="hidden"
        name="percentExpenses"
        value={JSON.stringify(percentExpenses)}
      />
      <input
        type="hidden"
        name="dealStages"
        value={JSON.stringify(dealStages)}
      />
      <input type="hidden" name="minMax" value={JSON.stringify(minMax)} />

      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-black text-white/85">
            Процентные расходы
          </div>
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/70"
            onClick={() =>
              setPercentExpenses((items) => [
                ...items,
                { id: uid("percent"), title: "", percent: 0, base: "subtotal" },
              ])
            }
          >
            Добавить
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          {percentExpenses.map((item, index) => (
            <div
              key={item.id || index}
              className="grid gap-2 md:grid-cols-[minmax(0,1fr)_110px_140px_auto]"
            >
              <SmallInput
                placeholder="Название"
                value={item.title || ""}
                onChange={(event) =>
                  setPercentExpenses((items) =>
                    items.map((row, i) =>
                      i === index ? { ...row, title: event.target.value } : row,
                    ),
                  )
                }
              />
              <SmallInput
                type="number"
                placeholder="%"
                value={item.percent ?? 0}
                onChange={(event) =>
                  setPercentExpenses((items) =>
                    items.map((row, i) =>
                      i === index
                        ? { ...row, percent: Number(event.target.value) }
                        : row,
                    ),
                  )
                }
              />
              <SmallSelect
                value={item.base || "subtotal"}
                onChange={(event) =>
                  setPercentExpenses((items) =>
                    items.map((row, i) =>
                      i === index ? { ...row, base: event.target.value } : row,
                    ),
                  )
                }
              >
                <option value="source">{uiLabel("source")}</option>
                <option value="subtotal">{uiLabel("subtotal")}</option>
                <option value="total">{uiLabel("total")}</option>
              </SmallSelect>
              <button
                type="button"
                className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-black text-red-100"
                onClick={() =>
                  setPercentExpenses((items) =>
                    items.filter((_, i) => i !== index),
                  )
                }
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="text-sm font-black text-white/85">
          Минимальные и максимальные значения
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <SmallInput
            type="number"
            placeholder="Мин. бюджет"
            value={minMax.minimumBudgetRub || ""}
            onChange={(event) =>
              setMinMax((value: any) => ({
                ...value,
                minimumBudgetRub: Number(event.target.value) || null,
              }))
            }
          />
          <SmallInput
            type="number"
            placeholder="Макс. бюджет"
            value={minMax.maximumBudgetRub || ""}
            onChange={(event) =>
              setMinMax((value: any) => ({
                ...value,
                maximumBudgetRub: Number(event.target.value) || null,
              }))
            }
          />
          <SmallInput
            type="number"
            placeholder="Мин. год"
            value={minMax.minimumYear || ""}
            onChange={(event) =>
              setMinMax((value: any) => ({
                ...value,
                minimumYear: Number(event.target.value) || null,
              }))
            }
          />
          <SmallInput
            type="number"
            placeholder="Макс. год"
            value={minMax.maximumYear || ""}
            onChange={(event) =>
              setMinMax((value: any) => ({
                ...value,
                maximumYear: Number(event.target.value) || null,
              }))
            }
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-black text-white/85">Этапы сделки</div>
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/70"
            onClick={() =>
              setDealStages((items) => [
                ...items,
                {
                  order: items.length + 1,
                  title: "",
                  description: "",
                  trigger: "",
                  amount: null,
                  amountType: "manual",
                  payer: "client",
                  recipient: "",
                  includedInTotal: true,
                  refundable: false,
                  required: true,
                  paymentDue: "",
                  active: true,
                },
              ])
            }
          >
            Добавить этап
          </button>
        </div>
        <div className="mt-3 grid gap-3">
          {dealStages.map((stage, index) => (
            <div
              key={`${stage.order}-${index}`}
              className="grid gap-2 rounded-xl border border-white/8 bg-white/[0.035] p-3"
            >
              <div className="grid gap-2 md:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_120px]">
                <SmallInput
                  type="number"
                  value={stage.order || index + 1}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? { ...row, order: Number(event.target.value) }
                          : row,
                      ),
                    )
                  }
                />
                <SmallInput
                  placeholder="Название"
                  value={stage.title || ""}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? { ...row, title: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <SmallInput
                  placeholder={uiLabel("Trigger")}
                  value={stage.trigger || ""}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? { ...row, trigger: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <SmallSelect
                  value={stage.amountType || "manual"}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? { ...row, amountType: event.target.value }
                          : row,
                      ),
                    )
                  }
                >
                  <option value="fixed">{uiLabel("fixed")}</option>
                  <option value="percent">{uiLabel("percent")}</option>
                  <option value="calculated">{uiLabel("calculated")}</option>
                  <option value="manual">{uiLabel("manual")}</option>
                </SmallSelect>
              </div>
              <textarea
                placeholder="Описание"
                value={stage.description || ""}
                onChange={(event) =>
                  setDealStages((items) =>
                    items.map((row, i) =>
                      i === index
                        ? { ...row, description: event.target.value }
                        : row,
                    ),
                  )
                }
                className="soft-input min-w-0 rounded-xl bg-zinc-950 px-3 py-2.5 text-xs font-bold text-white placeholder:text-white/25"
              />
              <div className="grid gap-2 md:grid-cols-4">
                <SmallInput
                  type="number"
                  placeholder="Сумма"
                  value={stage.amount ?? ""}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              amount:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            }
                          : row,
                      ),
                    )
                  }
                />
                <SmallInput
                  placeholder={uiLabel("payer")}
                  value={stage.payer || ""}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? { ...row, payer: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <SmallInput
                  placeholder={uiLabel("recipient")}
                  value={stage.recipient || ""}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? { ...row, recipient: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <SmallInput
                  placeholder="Срок оплаты"
                  value={stage.paymentDue || ""}
                  onChange={(event) =>
                    setDealStages((items) =>
                      items.map((row, i) =>
                        i === index
                          ? { ...row, paymentDue: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
              <div className="flex flex-wrap gap-3 text-xs font-bold text-white/58">
                {["includedInTotal", "refundable", "required", "active"].map(
                  (key) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(stage[key])}
                        onChange={(event) =>
                          setDealStages((items) =>
                            items.map((row, i) =>
                              i === index
                                ? { ...row, [key]: event.target.checked }
                                : row,
                            ),
                          )
                        }
                      />
                      {uiLabel(key)}
                    </label>
                  ),
                )}
                <button
                  type="button"
                  className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-black text-red-100"
                  onClick={() =>
                    setDealStages((items) =>
                      items
                        .filter((_, i) => i !== index)
                        .map((row, i) => ({ ...row, order: i + 1 })),
                    )
                  }
                >
                  Удалить из новой версии
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CpaStructuredFields({ network }: { network: any }) {
  const [statusRows, setStatusRows] = useState(
    Object.entries(network?.statusMapping || {}).map(
      ([internalStatus, networkStatus]) => ({ internalStatus, networkStatus }),
    ),
  );
  const [headerRows, setHeaderRows] = useState(
    Object.entries(network?.postbackConfig?.headers || {}).map(
      ([key, value]) => ({ key, value }),
    ),
  );
  const [method, setMethod] = useState(
    network?.postbackConfig?.method || "GET",
  );
  const [urlTemplate, setUrlTemplate] = useState(
    network?.postbackConfig?.urlTemplate || "",
  );
  const statusMapping = Object.fromEntries(
    statusRows
      .filter((row: any) => row.internalStatus)
      .map((row: any) => [row.internalStatus, row.networkStatus]),
  );
  const headers = Object.fromEntries(
    headerRows
      .filter((row: any) => row.key)
      .map((row: any) => [row.key, row.value]),
  );

  return (
    <div className="grid gap-4 md:col-span-2">
      <input
        type="hidden"
        name="statusMapping"
        value={JSON.stringify(statusMapping)}
      />
      <input
        type="hidden"
        name="postbackConfig"
        value={JSON.stringify({ method, urlTemplate, headers })}
      />
      <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
        <SmallSelect
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </SmallSelect>
        <SmallInput
          placeholder="Postback URL"
          value={urlTemplate}
          onChange={(event) => setUrlTemplate(event.target.value)}
        />
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex justify-between">
          <b>Status mapping</b>
          <button
            type="button"
            onClick={() =>
              setStatusRows((rows: any[]) => [
                ...rows,
                { internalStatus: "", networkStatus: "" },
              ])
            }
          >
            Добавить
          </button>
        </div>
        {statusRows.map((row: any, index) => (
          <div
            key={index}
            className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]"
          >
            <SmallInput
              placeholder="internal"
              value={row.internalStatus}
              onChange={(event) =>
                setStatusRows((rows: any[]) =>
                  rows.map((item, i) =>
                    i === index
                      ? { ...item, internalStatus: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <SmallInput
              placeholder="network"
              value={row.networkStatus}
              onChange={(event) =>
                setStatusRows((rows: any[]) =>
                  rows.map((item, i) =>
                    i === index
                      ? { ...item, networkStatus: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <button
              type="button"
              onClick={() =>
                setStatusRows((rows) => rows.filter((_, i) => i !== index))
              }
            >
              Удалить
            </button>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex justify-between">
          <b>Headers</b>
          <button
            type="button"
            onClick={() =>
              setHeaderRows((rows: any[]) => [...rows, { key: "", value: "" }])
            }
          >
            Добавить
          </button>
        </div>
        {headerRows.map((row: any, index) => (
          <div
            key={index}
            className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]"
          >
            <SmallInput
              placeholder="key"
              value={row.key}
              onChange={(event) =>
                setHeaderRows((rows: any[]) =>
                  rows.map((item, i) =>
                    i === index ? { ...item, key: event.target.value } : item,
                  ),
                )
              }
            />
            <SmallInput
              placeholder="value"
              value={row.value}
              onChange={(event) =>
                setHeaderRows((rows: any[]) =>
                  rows.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              onClick={() =>
                setHeaderRows((rows) => rows.filter((_, i) => i !== index))
              }
            >
              Удалить
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
