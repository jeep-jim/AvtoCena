'use client';
import {createContext,useContext} from 'react';
export const DealerDemoContext=createContext(false);
export const useDealerDemo=()=>useContext(DealerDemoContext);
