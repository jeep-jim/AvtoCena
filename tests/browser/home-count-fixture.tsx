import React from 'react';
import {createRoot} from 'react-dom/client';
import HomePageClient from '../../apps/web/components/home/HomePageClient';
import {PublicUiEnhancer} from '../../apps/web/components/layout/PublicUiEnhancer';
import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
import styles from '../../apps/web/app/(public)/home.module.css';
createRoot(document.getElementById('root')!).render(<><div className={styles.scope}><HomePageClient initialCount={100000}/></div><PublicLegalFooter/><PublicUiEnhancer/></>);
