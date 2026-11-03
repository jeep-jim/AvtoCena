import './cabinet.css';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {DealerCabinetNavigation} from '@/components/dealers/DealerCabinetNavigation';
export default function DealerCabinetLayout({children}:{children:React.ReactNode}){
 return <div className="dealer-cabinet-shell min-h-screen bg-[var(--ac-page-bg)] text-[var(--ac-text)]"><div className="ac-page-copy"><PublicHeader backHref="/cars"/></div><DealerCabinetNavigation/>{children}</div>;
}
