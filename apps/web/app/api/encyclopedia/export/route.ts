export const dynamic='force-dynamic';
export async function GET(){return Response.json({error:'Выгрузка базы недоступна.'},{status:403,headers:{'Cache-Control':'no-store'}});}
