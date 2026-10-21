export const VIEWPORT={width:420,height:640};
export function validatePoints(points){
 if(!Array.isArray(points)||points.length<1||points.length>32||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>=VIEWPORT.width||p.y<0||p.y>=VIEWPORT.height))throw Error('invalid_pointer');
 return points.map(({x,y})=>({x,y}));
}
export function pageKind(url,text){
 const path=new URL(url).pathname;
 if(/showcaptcha|checkcaptcha|captcha/i.test(path)||/Подтвердите, что вы не робот|Verify you are human|Я не робот/i.test(text))return 'challenge';
 if(/Доступ ограничен|Доступ заблокирован|Access denied/i.test(text))return 'blocked';
 return 'page';
}
export async function replayPointer(page,points){
 const path=validatePoints(points);
 if(path.length===1){await page.mouse.click(path[0].x,path[0].y);return;}
 await page.mouse.move(path[0].x,path[0].y);
 await page.mouse.down();
 try{for(const point of path.slice(1))await page.mouse.move(point.x,point.y);}
 finally{await page.mouse.up().catch(()=>{});}
}
