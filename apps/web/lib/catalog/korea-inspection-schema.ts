/** Labels and schematic positions for parts explicitly named by the inspection document.
 * Positions are illustrative, not measurements. Empty marks never mean undamaged. */
export const koreaBodyParts = {
 hood:['Капот','outer',100,53],
 frontFenderLeft:['Переднее левое крыло','outer',36,67], frontFenderRight:['Переднее правое крыло','outer',164,67],
 frontDoorLeft:['Передняя левая дверь','outer',36,118], frontDoorRight:['Передняя правая дверь','outer',164,118],
 rearDoorLeft:['Задняя левая дверь','outer',36,163], rearDoorRight:['Задняя правая дверь','outer',164,163],
 trunkLead:['Крышка багажника','outer',100,231], radiatorSupport:['Панель крепления радиатора','outer',100,22],
 roofPanel:['Панель крыши','outer',100,148], quarterPanelLeft:['Заднее левое крыло','outer',36,211], quarterPanelRight:['Заднее правое крыло','outer',164,211],
 sideSillPanelLeft:['Левый порог','outer',15,147], sideSillPanelRight:['Правый порог','outer',185,147],
 frontPanel:['Передняя панель','frame',100,25], crossMember:['Поперечина','frame',100,87],
 insidePanelLeft:['Передняя внутренняя левая панель','frame',49,47], insidePanelRight:['Передняя внутренняя правая панель','frame',151,47],
 rearPanel:['Задняя панель','frame',100,249], trunkFloor:['Пол багажника','frame',100,219],
 frontSideMemberLeft:['Передний левый лонжерон','frame',77,57], frontSideMemberRight:['Передний правый лонжерон','frame',123,57],
 rearSideMemberLeft:['Задний левый лонжерон','frame',77,236], rearSideMemberRight:['Задний правый лонжерон','frame',123,236],
 frontWheelHouseLeft:['Передняя левая колёсная арка','frame',46,77], frontWheelHouseRight:['Передняя правая колёсная арка','frame',154,77],
 rearWheelHouseLeft:['Задняя левая колёсная арка','frame',46,204], rearWheelHouseRight:['Задняя правая колёсная арка','frame',154,204],
 pillarPanelFrontLeft:['Передняя левая стойка','frame',31,109], pillarPanelFrontRight:['Передняя правая стойка','frame',169,109],
 pillarPanelMiddleLeft:['Средняя левая стойка','frame',31,145], pillarPanelMiddleRight:['Средняя правая стойка','frame',169,145],
 pillarPanelRearLeft:['Задняя левая стойка','frame',31,180], pillarPanelRearRight:['Задняя правая стойка','frame',169,180],
 packageTray:['Задняя полка','frame',100,188], dashPanel:['Щит передка','frame',100,109], floorPanel:['Панель пола','frame',100,148],
} as const;
export const koreaBodyConditions = {CHANGE:'Замена',METAL:'Рихтовка / сварка',CORROSION:'Коррозия',SCRATCH:'Царапины',HILLS:'Неровности',DAMAGE:'Повреждение'} as const;
export type KoreaBodyPartKey=keyof typeof koreaBodyParts;
export type KoreaBodyCondition=keyof typeof koreaBodyConditions;
export type KoreaBodyInspection={parts:{key:KoreaBodyPartKey;conditions:KoreaBodyCondition[]}[];unmapped:boolean};
