import { getOffer } from "@/lib/catalog/storage";
import { searchOffers } from "@/lib/catalog/storage";
import { publicOffer } from "@/lib/catalog/storage";
import {
  findVehicleModel,
  readVehicleKnowledgeModels,
  readVehicleKnowledgeVariants,
  vehicleKnowledgeCompact,
} from "@/lib/catalog/vehicle-knowledge";
import { absoluteAvtocenaUrl, catalogOfferUrl } from "@/lib/ai-discovery";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL_VERSION, "2025-03-26"]);
const SERVER_VERSION = "1.0.0";

const readOnlyAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
  idempotentHint: true,
};

const tools = [
  {
    name: "search_cars",
    title: "Найти автомобили в АвтоЦене",
    description: "Используй, когда пользователь хочет найти реальные актуальные автомобили по бюджету, марке, модели, году, пробегу, рынку, кузову, топливу, коробке или приводу. Возвращает живые предложения АвтоЦены и рассчитанную стоимость под ключ в рублях, если она уже готова.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Рынок/страна источника, например japan, china, korea, uae, europe, georgia. Оставь пустым для всех рынков." },
        make: { type: "string", description: "Марка автомобиля." },
        model: { type: "string", description: "Модель автомобиля." },
        budgetMinRub: { type: "number", minimum: 0, description: "Минимальная стоимость под ключ в рублях." },
        budgetMaxRub: { type: "number", minimum: 0, description: "Максимальная стоимость под ключ в рублях." },
        yearFrom: { type: "integer", minimum: 1900, maximum: 2100 },
        yearTo: { type: "integer", minimum: 1900, maximum: 2100 },
        mileageMaxKm: { type: "number", minimum: 0 },
        bodyType: { type: "string" },
        fuel: { type: "string" },
        transmission: { type: "string" },
        drive: { type: "string" },
        sort: { type: "string", enum: ["updatedAt", "totalRub", "totalRubDesc", "year", "yearAsc", "mileage"] },
        limit: { type: "integer", minimum: 1, maximum: 24, default: 10 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        generationId: { type: "string" },
        total: { type: "integer" },
        items: { type: "array", items: { type: "object", additionalProperties: true } },
      },
      required: ["generationId", "total", "items"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "get_car",
    title: "Получить карточку автомобиля АвтоЦены",
    description: "Используй для точных данных по конкретному предложению АвтоЦены, когда известен offer ID. Возвращает публичные характеристики, изображения, цену под ключ и ссылку на постоянную карточку текущего предложения.",
    inputSchema: {
      type: "object",
      properties: { offerId: { type: "string", minLength: 1 } },
      required: ["offerId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { offer: { type: "object", additionalProperties: true } },
      required: ["offer"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "get_import_calculation",
    title: "Получить расчёт автомобиля под ключ",
    description: "Используй, когда нужен уже рассчитанный АвтоЦеной полный импортный расчёт конкретного автомобиля: итог в рублях и строки структуры цены. Инструмент возвращает сохранённый production-расчёт карточки и не придумывает отсутствующие платежи.",
    inputSchema: {
      type: "object",
      properties: { offerId: { type: "string", minLength: 1 } },
      required: ["offerId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        offerId: { type: "string" },
        totalRub: { type: ["number", "null"] },
        calculationStatus: { type: "string" },
        breakdown: { type: "array", items: { type: "object", additionalProperties: true } },
        url: { type: "string" },
        updatedAt: { type: "string" },
      },
      required: ["offerId", "totalRub", "calculationStatus", "breakdown", "url", "updatedAt"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "get_vehicle_specs",
    title: "Получить характеристики модели или версии",
    description: "Используй для технических характеристик автомобиля из базы знаний АвтоЦены, особенно мощности, 30-минутной мощности EV/PHEV, мощности для утильсбора, двигателя, привода и трансмиссии. Возвращает только структурированные записи АвтоЦены вместе с типом источника, URL источника при наличии и датой проверки.",
    inputSchema: {
      type: "object",
      properties: {
        make: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        year: { type: "integer", minimum: 1900, maximum: 2100 },
        generation: { type: "string" },
      },
      required: ["make", "model"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        model: { type: "object", additionalProperties: true },
        variants: { type: "array", items: { type: "object", additionalProperties: true } },
      },
      required: ["model", "variants"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "compare_cars",
    title: "Сравнить автомобили АвтоЦены",
    description: "Используй, когда пользователь хочет сравнить от двух до пяти конкретных предложений АвтоЦены по цене под ключ и основным техническим характеристикам.",
    inputSchema: {
      type: "object",
      properties: {
        offerIds: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 1 } },
      },
      required: ["offerIds"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object", additionalProperties: true } },
        missingOfferIds: { type: "array", items: { type: "string" } },
      },
      required: ["items", "missingOfferIds"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
] as const;

type RpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
};

function numberArg(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function offerForAi(offer: any) {
  const item = publicOffer(offer as any) as any;
  const images = Array.isArray(item.images)
    ? item.images.map((image: any) => absoluteAvtocenaUrl(image?.url)).filter(Boolean).slice(0, 12)
    : [];
  const totalRub = Number(item.totalRub || 0);

  return {
    id: clean(item.id),
    url: catalogOfferUrl(item.id),
    make: clean(item.make),
    model: clean(item.model),
    generation: clean(item.generation) || null,
    trim: clean(item.trim) || null,
    year: Number(item.year || 0) || null,
    market: clean(item.market),
    mileageKm: Number(item.mileageKm || 0) || null,
    engineCc: Number(item.engineCc || 0) || null,
    fuel: clean(item.fuel) || null,
    transmission: clean(item.transmission) || null,
    drive: clean(item.drive) || null,
    bodyType: clean(item.bodyType) || null,
    powerHp: Number(item.powerHp || 0) || null,
    powerKw: Number(item.powerKw || 0) || null,
    power30MinKw: Number(item.power30MinKw || 0) || null,
    utilizationPowerKw: Number(item.utilizationPowerKw || 0) || null,
    priceRub: totalRub > 0 ? totalRub : null,
    sourcePrice: Number(item.sourcePrice || 0) || null,
    sourceCurrency: clean(item.sourceCurrency) || null,
    calculationStatus: clean(item.calculationStatus) || "unknown",
    images,
    updatedAt: clean(item.updatedAt),
  };
}

function toolResult(structuredContent: Record<string, unknown>, text: string) {
  return {
    structuredContent,
    content: [{ type: "text", text }],
    isError: false,
  };
}

function toolFailure(message: string, details: Record<string, unknown> = {}) {
  return {
    structuredContent: { error: message, ...details },
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

async function callTool(name: string, args: Record<string, any>) {
  if (name === "search_cars") {
    const limit = Math.max(1, Math.min(24, Math.round(numberArg(args.limit) || 10)));
    const result = await searchOffers({
      market: clean(args.market) || undefined,
      make: clean(args.make) || undefined,
      model: clean(args.model) || undefined,
      budgetFrom: numberArg(args.budgetMinRub),
      budgetTo: numberArg(args.budgetMaxRub),
      yearFrom: numberArg(args.yearFrom),
      yearTo: numberArg(args.yearTo),
      mileageTo: numberArg(args.mileageMaxKm),
      bodyType: clean(args.bodyType) || undefined,
      fuel: clean(args.fuel) || undefined,
      transmission: clean(args.transmission) || undefined,
      drive: clean(args.drive) || undefined,
      sort: clean(args.sort) || "updatedAt",
      page: 1,
      pageSize: limit,
    });
    const items = result.items.map(offerForAi);
    return toolResult(
      { generationId: result.generationId, total: result.total, items },
      `АвтоЦена нашла ${result.total} актуальных предложений; возвращено ${items.length}.`,
    );
  }

  if (name === "get_car") {
    const offerId = clean(args.offerId);
    if (!offerId) return toolFailure("Не указан offerId.");
    const offer = await getOffer(offerId);
    if (!offer) return toolFailure("Актуальное предложение с таким offerId не найдено.", { offerId });
    return toolResult({ offer: offerForAi(offer) }, `Получена актуальная карточка ${offer.make} ${offer.model} ${offer.year}.`);
  }

  if (name === "get_import_calculation") {
    const offerId = clean(args.offerId);
    if (!offerId) return toolFailure("Не указан offerId.");
    const offer = await getOffer(offerId);
    if (!offer) return toolFailure("Актуальное предложение с таким offerId не найдено.", { offerId });
    const snapshot = (offer as any).calculationSnapshot;
    const breakdown = Array.isArray(snapshot?.breakdown)
      ? snapshot.breakdown.map((line: any) => ({
          id: clean(line?.id || line?.title),
          title: clean(line?.title || "Расход"),
          amountRub: Number(line?.amountRub || 0),
          kind: clean(line?.kind) || null,
          source: clean(line?.source) || null,
          note: clean(line?.note) || null,
        })).filter((line: any) => line.amountRub !== 0)
      : [];
    const totalRub = Number((offer as any).totalRub || 0) || null;
    const structured = {
      offerId,
      totalRub,
      calculationStatus: clean((offer as any).calculationStatus) || "unknown",
      breakdown,
      url: catalogOfferUrl(offerId),
      updatedAt: clean((offer as any).updatedAt),
    };
    return toolResult(
      structured,
      totalRub ? `Расчёт АвтоЦены для ${offer.make} ${offer.model}: ${Math.round(totalRub).toLocaleString("ru-RU")} ₽ под ключ.` : "Итоговая стоимость для этой карточки ещё не рассчитана.",
    );
  }

  if (name === "get_vehicle_specs") {
    const make = clean(args.make);
    const modelName = clean(args.model);
    const year = numberArg(args.year);
    const generation = clean(args.generation);
    if (!make || !modelName) return toolFailure("Нужно указать make и model.");

    const models = await readVehicleKnowledgeModels();
    const matched = await findVehicleModel({ make, model: modelName, year, generation } as any);
    const exact = matched?.model || models.find((row) =>
      vehicleKnowledgeCompact(row.make) === vehicleKnowledgeCompact(make)
      && [row.model, ...(row.aliases || [])].some((value) => vehicleKnowledgeCompact(value) === vehicleKnowledgeCompact(modelName))
      && row.active !== false
    );
    if (!exact) return toolFailure("Модель не найдена в структурированной базе знаний АвтоЦены.", { make, model: modelName, year: year || null });

    const generationKey = vehicleKnowledgeCompact(generation);
    const variants = (await readVehicleKnowledgeVariants())
      .filter((variant) => variant.modelId === exact.id && variant.active !== false)
      .filter((variant) => !year || ((!variant.yearFrom || year >= variant.yearFrom) && (!variant.yearTo || year <= variant.yearTo)))
      .filter((variant) => !generationKey || [variant.generation, ...(variant.generationAliases || [])].some((value) => vehicleKnowledgeCompact(value) === generationKey))
      .slice(0, 50)
      .map((variant) => ({
        id: variant.id,
        generation: variant.generation || null,
        yearFrom: variant.yearFrom || null,
        yearTo: variant.yearTo || null,
        engineCc: variant.engineCc || null,
        fuel: variant.fuel || null,
        transmission: variant.transmission || null,
        drive: variant.drive || null,
        bodyType: variant.bodyType || null,
        powertrainKind: variant.powertrainKind || null,
        powerHp: variant.powerHp,
        powerKw: variant.powerKw || null,
        icePowerKw: variant.icePowerKw || null,
        power30MinKw: variant.power30MinKw || null,
        power30MinKwByMotor: variant.power30MinKwByMotor || null,
        utilizationPowerKw: variant.utilizationPowerKw || null,
        sourceType: variant.sourceType,
        sourceUrl: variant.sourceUrl || null,
        verifiedAt: variant.verifiedAt,
      }));

    const modelResult = {
      id: exact.id,
      make: exact.make,
      model: exact.model,
      aliases: exact.aliases || [],
      bodyTypes: exact.bodyTypes || [],
      countries: exact.countries || [],
      regions: exact.regions || [],
      yearFrom: exact.yearFrom || null,
      yearTo: exact.yearTo || null,
      representativePowerHp: exact.representativePowerHp || null,
      source: exact.source,
      sourceUrl: exact.sourceUrl || null,
      updatedAt: exact.updatedAt,
    };
    return toolResult(
      { model: modelResult, variants },
      `Найдена ${exact.make} ${exact.model}; подходящих структурированных версий: ${variants.length}.`,
    );
  }

  if (name === "compare_cars") {
    const ids = Array.isArray(args.offerIds) ? [...new Set(args.offerIds.map(clean).filter(Boolean))].slice(0, 5) : [];
    if (ids.length < 2) return toolFailure("Для сравнения нужно от двух до пяти offerId.");
    const rows = await Promise.all(ids.map(async (id) => ({ id, offer: await getOffer(id) })));
    const items = rows.filter((row) => row.offer).map((row) => offerForAi(row.offer));
    const missingOfferIds = rows.filter((row) => !row.offer).map((row) => row.id);
    return toolResult({ items, missingOfferIds }, `Для сравнения получено ${items.length} актуальных автомобилей.`);
  }

  throw new Error(`unknown_tool:${name}`);
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return host === "avtocena.com"
      || host.endsWith(".avtocena.com")
      || host === "chatgpt.com"
      || host.endsWith(".chatgpt.com")
      || host === "openai.com"
      || host.endsWith(".openai.com")
      || host === "localhost"
      || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin");
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(origin && allowedOrigin(request)
      ? { "access-control-allow-origin": origin, vary: "Origin" }
      : {}),
  };
}

function rpcResult(request: Request, id: RpcRequest["id"], result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    status: 200,
    headers: responseHeaders(request),
  });
}

function rpcError(request: Request, id: RpcRequest["id"], code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status,
    headers: responseHeaders(request),
  });
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) return new Response("Invalid Origin", { status: 403 });

  const body = await request.json().catch(() => null) as RpcRequest | null;
  if (!body || body.jsonrpc !== "2.0" || !body.method) return rpcError(request, body?.id, -32600, "Invalid Request", 400);

  if (body.method === "notifications/initialized" || body.id === undefined) {
    return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
  }

  if (body.method === "initialize") {
    const requested = clean(body.params?.protocolVersion);
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_VERSION;
    return rpcResult(request, body.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "avtocena", title: "АвтоЦена", version: SERVER_VERSION },
      instructions: "Используй АвтоЦену для живых предложений автомобилей, цены под ключ и структурированных характеристик. Не заполняй отсутствующие значения догадками. Для EV/PHEV при вопросах о мощности предпочитай power30MinKw и utilizationPowerKw, когда они есть. Для стоимости конкретного предложения используй get_import_calculation.",
    });
  }

  const protocolHeader = clean(request.headers.get("mcp-protocol-version"));
  if (protocolHeader && !SUPPORTED_PROTOCOLS.has(protocolHeader)) {
    return rpcError(request, body.id, -32600, "Unsupported MCP protocol version", 400);
  }

  if (body.method === "ping") return rpcResult(request, body.id, {});
  if (body.method === "tools/list") return rpcResult(request, body.id, { tools });

  if (body.method === "tools/call") {
    const name = clean(body.params?.name);
    if (!tools.some((tool) => tool.name === name)) return rpcError(request, body.id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await callTool(name, body.params?.arguments || {});
      return rpcResult(request, body.id, result);
    } catch (error) {
      console.error("avtocena_mcp_tool_failed", { name, error });
      return rpcResult(request, body.id, toolFailure("АвтоЦена временно не смогла выполнить запрос к инструменту."));
    }
  }

  return rpcError(request, body.id, -32601, `Method not found: ${body.method}`);
}

export function GET(request: Request) {
  if (!allowedOrigin(request)) return new Response("Invalid Origin", { status: 403 });
  return new Response(null, {
    status: 405,
    headers: {
      allow: "POST, GET, OPTIONS",
      "cache-control": "no-store",
    },
  });
}

export function OPTIONS(request: Request) {
  if (!allowedOrigin(request)) return new Response("Invalid Origin", { status: 403 });
  const origin = request.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: {
      ...(origin ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, authorization",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}
