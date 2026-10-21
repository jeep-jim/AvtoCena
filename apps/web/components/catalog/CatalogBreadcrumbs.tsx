import {DealerLink as Link} from "@/components/dealers/DealerBrowsingContext";
export function CatalogBreadcrumbs({items}:{items:Array<{label:string;href:string}>}){return <nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs ac-hide-scrollbar -mx-1 mb-4 flex min-w-0 items-center gap-x-2 overflow-x-auto whitespace-nowrap px-1 pb-1 text-[11px] font-black normal-case tracking-normal text-[var(--ac-muted)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mb-5 md:overflow-visible md:text-xs">
          {items.map((item, index) => <span key={`${item.href}-${item.label}`} className="flex shrink-0 items-center gap-x-2">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {index === items.length - 1 ? <span aria-current="page">{item.label}</span> : <Link href={item.href} className="transition hover:text-red-500">{item.label}</Link>}
          </span>)}
        </nav>;}
