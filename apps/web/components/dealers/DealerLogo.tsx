export function DealerLogo({logoLight,logoDark,name=''}:{logoLight?:string;logoDark?:string;name?:string}) {
 const light=logoLight||logoDark||'/logo/avtocena-mark-dark.svg';
 const dark=logoDark||logoLight||'/logo/avtocena-mark-dark.svg';
 return <span className="ac-dealer-logo"><img className="ac-dealer-logo-light" src={light==='/brands/topavto-logo.png'?'/brands/topavto-logo-black.png':light} alt={name}/><img className="ac-dealer-logo-dark" src={dark} alt={name}/><style>{`.ac-dealer-logo{display:block;width:100%;height:100%;overflow:hidden;border-radius:50%;background:var(--ac-surface-2)}.ac-dealer-logo img{width:100%;height:100%;object-fit:contain;filter:none!important}.ac-dealer-logo .ac-dealer-logo-light{display:none}.ac-dealer-logo .ac-dealer-logo-dark{display:block}html[data-theme=light] .ac-dealer-logo .ac-dealer-logo-light{display:block}html[data-theme=light] .ac-dealer-logo .ac-dealer-logo-dark{display:none}`}</style></span>;
}
