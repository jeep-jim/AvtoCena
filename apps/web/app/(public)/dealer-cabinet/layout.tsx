import {PublicHeader} from '@/components/layout/PublicHeader';
import {DealerCabinetNavigation} from '@/components/dealers/DealerCabinetNavigation';
export default function DealerCabinetLayout({children}:{children:React.ReactNode}){
 return <div className="ac-page-copy min-h-screen bg-[var(--ac-page-bg)] text-[var(--ac-text)]"><PublicHeader backHref="/cars"/><DealerCabinetNavigation/>{children}</div>;
}
