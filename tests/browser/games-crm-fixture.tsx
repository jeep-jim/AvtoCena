import React from 'react';import {createRoot} from 'react-dom/client';
import {ChatWorkspace} from '../../apps/web/components/crm/ChatWorkspace';
import {GameButtons} from '../../apps/web/components/games/GamesHub';
const initial:any={userId:'staff',team:[],threads:[{id:'lead:test',kind:'lead',title:'Тестовый клиент',subtitle:'Проверка'}]};
createRoot(document.getElementById('root')!).render(<main><h1>Проверка игр и CRM</h1><GameButtons/><section data-lead-success><a href="/account">Войти в кабинет</a></section><ChatWorkspace initial={initial}/></main>);
