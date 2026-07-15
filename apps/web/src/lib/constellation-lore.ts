/**
 * 88 星座中文看点简介（星座信息卡数据源）。
 *
 * 全部为本项目原创撰写的中文文案，无第三方版权内容。
 * 12 黄道 + 8 精绘座（见 constellation-art.ts）为 2–3 句详述，其余 1 句速览。
 * brightestUid 指向目录内恒星（getCelestialByUid 可查则信息卡渲染为可点击）。
 */

export interface ConstellationLore {
  /** 最亮星展示文字，如「参宿七 β Ori」。 */
  brightest: string;
  /** 最亮星 objectUid（可点击飞往）；不在精选表内时省略。 */
  brightestUid?: string;
  /** 神话 / 看点中文简介。 */
  loreZh: string;
}

export const CONSTELLATION_LORE: Record<string, ConstellationLore> = {
  And: {
    brightest: '壁宿二 α And',
    brightestUid: 'HIP677',
    loreZh: '被锁在海边礁石上的埃塞俄比亚公主安德洛墨达，座内藏着肉眼可见最远的天体——仙女座大星系 M31。',
  },
  Ant: { brightest: 'α Ant', loreZh: '唧筒座是 18 世纪以抽气机命名的南天小星座，星光黯淡而安静。' },
  Aps: { brightest: 'α Aps', loreZh: '天燕座代表来自新几内亚的极乐鸟，静卧在南天极附近。' },
  Aqr: {
    brightest: '虚宿一 β Aqr',
    loreZh: '宝瓶是替众神斟酒的美少年伽倪墨得斯，被宙斯化作神鹰接上天庭。他手中的瓶倾泻不息，瓶口的水流一路淌向南边的南鱼座嘴边，秋夜里这片天区因此被古人称为「水乡」。',
  },
  Aql: {
    brightest: '牛郎星（河鼓二）α Aql',
    brightestUid: 'HIP97649',
    loreZh: '天鹰是替宙斯执掌雷霆的神鸟。鹰的心口即牛郎星，两侧各有一颗小星，正是传说里他用扁担挑着的一双儿女，与银河对岸的织女星遥遥相望。',
  },
  Ara: { brightest: 'β Ara', loreZh: '天坛座是众神结盟讨伐泰坦时焚香立誓的祭坛，烟气化作了银河。' },
  Ari: {
    brightest: '娄宿三 α Ari',
    brightestUid: 'HIP9884',
    loreZh: '白羊是驮着王子飞越大海的金毛羊，那身金羊毛后来引出了伊阿宋与阿尔戈英雄的远征。两千年前春分点正落在这里，它因此成为黄道十二宫的第一宫。',
  },
  Aur: {
    brightest: '五车二 α Aur',
    brightestUid: 'HIP24608',
    loreZh: '御夫座是发明四马战车的雅典王，怀中抱着一只母山羊——五车二。',
  },
  Boo: {
    brightest: '大角星 α Boo',
    brightestUid: 'HIP69673',
    loreZh: '牧夫追赶着大熊绕极巡行，座内大角星是北天最亮的恒星。',
  },
  Cae: { brightest: 'α Cae', loreZh: '雕具座以雕刻家的刻刀命名，是全天最暗弱的星座之一。' },
  Cam: { brightest: 'β Cam', loreZh: '鹿豹座填补着北极附近的空旷天区，名字来自「长颈鹿」的旧译。' },
  Cnc: {
    brightest: '柳宿增十 β Cnc',
    loreZh: '巨蟹是赫拉派去夹咬赫拉克勒斯脚踝的螃蟹，虽被一脚踩碎仍被升上星空。全座星光暗淡，中央却藏着肉眼可辨的鬼星团 M44——古人称之为「积尸气」，一团朦胧的光雾。',
  },
  CVn: { brightest: '常陈一 α CVn', loreZh: '猎犬座是牧夫牵着的两条猎犬，主星「查理之心」纪念英王查理一世。' },
  CMa: {
    brightest: '天狼星 α CMa',
    brightestUid: 'HIP32349',
    loreZh: '大犬是猎户奥利翁的猎犬，昂首处即全天最亮的天狼星。',
  },
  CMi: {
    brightest: '南河三 α CMi',
    brightestUid: 'HIP37279',
    loreZh: '小犬座只有两颗显眼的星，南河三与天狼星、参宿四组成冬季大三角。',
  },
  Cap: {
    brightest: '垒壁阵四 δ Cap',
    loreZh: '摩羯是牧神潘的化身：怪物突袭时他跳入尼罗河，入水的下半身变成鱼尾，岸上的上半身仍是山羊，从此成了星空里奇特的「海山羊」。它是黄道十二宫中最暗的一宫。',
  },
  Car: {
    brightest: '老人星 α Car',
    brightestUid: 'HIP30438',
    loreZh: '船底座是阿尔戈号巨船的龙骨，座内老人星是全天第二亮星。',
  },
  Cas: {
    brightest: '王良四 α Cas',
    loreZh: '仙后卡西俄佩亚因夸耀女儿比海仙更美而触怒海神，被罚坐在宝座上绕北极旋转，一半时间头朝下倒悬。五颗亮星组成的 W 是北天最易辨认的标志，与北斗隔极相望。',
  },
  Cen: {
    brightest: '南门二 α Cen',
    brightestUid: 'HIP71683',
    loreZh: '半人马喀戎是众英雄的导师，前蹄的南门二是离太阳最近的亮星。',
  },
  Cep: { brightest: '天钩五 α Cep', loreZh: '仙王座是仙后的丈夫、公主的父亲，一顶尖帽形的五边形星座。' },
  Cet: {
    brightest: '土司空 β Cet',
    brightestUid: 'HIP3419',
    loreZh: '鲸鱼座是扑向公主的海怪刻托，座内藏着著名的变星「怪星」刍藁增二。',
  },
  Cha: { brightest: 'α Cha', loreZh: '蝘蜓座即变色龙，潜伏在南天极旁，静待身边「苍蝇座」的猎物。' },
  Cir: { brightest: 'α Cir', loreZh: '圆规座是制图师的两脚规，紧贴着半人马座的亮星南门二。' },
  Col: { brightest: '丈人一 α Col', loreZh: '天鸽座是大洪水后衔回橄榄枝报平安的鸽子，落在大犬座脚边。' },
  Com: { brightest: '周鼎一 β Com', loreZh: '后发座是埃及王后贝勒尼基献给神的秀发，散作满天细碎星光。' },
  CrA: { brightest: 'α CrA', loreZh: '南冕座是人马座脚边一环小巧的花冠，南天银河畔的一枚弧线。' },
  CrB: { brightest: '贯索四 α CrB', loreZh: '北冕座是酒神送给公主阿里阿德涅的婚冠，七星围成一弯璀璨半环。' },
  Crv: { brightest: '轸宿一 γ Crv', loreZh: '乌鸦座因谎报差事被阿波罗罚作星，四边形小巧醒目，指向角宿一。' },
  Crt: { brightest: 'δ Crt', loreZh: '巨爵座是阿波罗的酒杯，与乌鸦座一同搁在长蛇的背脊上。' },
  Cru: {
    brightest: '十字架二 α Cru',
    brightestUid: 'HIP60718',
    loreZh: '南十字座是全天 88 座中最小的一个，却也是南半球夜空的圣物：四颗亮星组成端正的十字，长轴延长约四倍半便指向南天极。大航海时代起，它就是南方旅人的罗盘。',
  },
  Cyg: {
    brightest: '天津四 α Cyg',
    brightestUid: 'HIP102098',
    loreZh: '天鹅是宙斯的化身，沿银河展翅俯冲：尾羽的天津四极为遥远明亮，喙部的辇道增七是望远镜下最美的金蓝双星。它的十字形骨架又被称为「北十字」，与南十字遥相呼应。',
  },
  Del: { brightest: '瓠瓜一 β Del', loreZh: '海豚座救起过落水的歌手阿里翁，四星如一枚小巧的风筝跃出银河。' },
  Dor: { brightest: 'α Dor', loreZh: '剑鱼座身侧漂着大麦哲伦云——南天最壮观的伴星系。' },
  Dra: { brightest: '天棓四 γ Dra', loreZh: '天龙座是看守金苹果的巨龙，长长的龙身在两熊之间盘绕北极。' },
  Equ: { brightest: '虚宿二 α Equ', loreZh: '小马座是飞马的弟弟，全天第二小的星座，只露出一个马头。' },
  Eri: {
    brightest: '水委一 α Eri',
    brightestUid: 'HIP7588',
    loreZh: '波江座是法厄同驾日车坠落的长河，蜿蜒向南直到亮星水委一。',
  },
  For: { brightest: 'α For', loreZh: '天炉座是化学家的坩埚，这片幽暗天区曾被哈勃望远镜凝视出万千星系。' },
  Gem: {
    brightest: '北河三 β Gem',
    brightestUid: 'HIP37826',
    loreZh: '双子是一对同母异父的孪生兄弟：卡斯托耳是凡人，波吕丢刻斯不死。哥哥战死后，弟弟甘愿分出一半永生，宙斯感念手足情深，把两人并肩升上冬夜星空。',
  },
  Gru: { brightest: '鹤一 α Gru', loreZh: '天鹤座曲颈向南，是南天秋夜里姿态最优雅的水鸟。' },
  Her: { brightest: '天市右垣一 β Her', loreZh: '武仙座是单膝跪地的赫拉克勒斯，座内 M13 是北天最亮的球状星团。' },
  Hor: { brightest: 'α Hor', loreZh: '时钟座是天文学家的摆钟，孤悬在波江南岸的暗弱天区。' },
  Hya: {
    brightest: '星宿一 α Hya',
    brightestUid: 'HIP46390',
    loreZh: '长蛇座是赫拉克勒斯斩杀的九头蛇，全天最长最大的星座。',
  },
  Hyi: { brightest: 'β Hyi', loreZh: '水蛇座游弋在大小麦哲伦云之间，是深南天的一尾小蛇。' },
  Ind: { brightest: '波斯二 α Ind', loreZh: '印第安座纪念大航海时代所见的原住民形象，静立南天。' },
  Lac: { brightest: '螣蛇一 α Lac', loreZh: '蝎虎座在天鹅与仙女之间蜿蜒，小巧的 W 形常被误认成仙后。' },
  Leo: {
    brightest: '轩辕十四 α Leo',
    brightestUid: 'HIP49669',
    loreZh: '狮子是赫拉克勒斯十二伟业的第一战——刀枪不入的涅墨亚猛狮，被英雄扼杀后升上春夜星空。头颈的镰刀形星群如同扬起的鬃毛，心脏处的轩辕十四几乎正踩在黄道上。',
  },
  LMi: { brightest: '势四 46 LMi', loreZh: '小狮座蜷在大熊掌下，是一头连 α 星都没有正式编号的小狮。' },
  Lep: { brightest: '厕一 α Lep', loreZh: '天兔座蹲伏在猎户脚边，永远被大犬追逐着奔向西方。' },
  Lib: {
    brightest: '氐宿四 β Lib',
    loreZh: '天秤是正义女神阿斯特赖亚手中的天平，也是黄道十二宫中唯一的器物。它原本是天蝎伸出的双螯，两颗主星至今仍叫「南螯」与「北螯」，见证着星空版图的变迁。',
  },
  Lup: { brightest: '骑官十 α Lup', loreZh: '豺狼座被半人马的长矛挑向天坛，是南天银河边的祭品。' },
  Lyn: { brightest: '轩辕四 α Lyn', loreZh: '天猫座暗弱难辨，命名者戏言「须有山猫般的眼力才能看见」。' },
  Lyr: {
    brightest: '织女星 α Lyr',
    brightestUid: 'HIP91262',
    loreZh: '天琴是俄耳甫斯的竖琴，琴声能令顽石落泪、猛兽俯首。座内织女星是夏夜头顶最亮的星，与银河对岸的牛郎星隔河相望，正是七夕传说的主角。',
  },
  Men: { brightest: 'α Men', loreZh: '山案座得名于开普敦的桌案山，是全天最暗的星座。' },
  Mic: { brightest: 'γ Mic', loreZh: '显微镜座是 18 世纪科学仪器星座家族的一员，安静而暗淡。' },
  Mon: { brightest: 'β Mon', loreZh: '麒麟座横跨冬季大三角中央，藏着绚丽的玫瑰星云。' },
  Mus: { brightest: 'α Mus', loreZh: '苍蝇座是南十字脚下的一只小飞虫，全天唯一的昆虫星座。' },
  Nor: { brightest: 'γ² Nor', loreZh: '矩尺座是木匠的直角尺，嵌在银河最浓密的南段。' },
  Oct: { brightest: 'ν Oct', loreZh: '南极座包住南天极点，却没有一颗像北极星那样醒目的极星。' },
  Oph: {
    brightest: '侯 α Oph',
    brightestUid: 'HIP86032',
    loreZh: '蛇夫是医神阿斯克勒庇俄斯，手擎巨蛇——太阳每年也要从他脚下经过。',
  },
  Ori: {
    brightest: '参宿七 β Ori',
    brightestUid: 'HIP24436',
    loreZh: '猎户奥利翁是希腊神话中最英武的猎人，死后被升上冬夜星空。腰带三星整齐排列，是全天最易辨认的标志；左肩参宿四赤红、右脚参宿七蓝白，佩剑处还藏着孕育新星的猎户座大星云。',
  },
  Pav: {
    brightest: '孔雀十一 α Pav',
    brightestUid: 'HIP100751',
    loreZh: '孔雀座是赫拉的圣鸟，尾羽上缀着百眼巨人的眼睛。',
  },
  Peg: {
    brightest: '危宿三 ε Peg',
    loreZh: '飞马珀伽索斯诞生于美杜莎被斩落的颈血，一蹄踏出灵感之泉。星空里它只露出倒挂的前半身，躯干化作著名的「秋季四边形」——认秋夜星空，从这里开始。',
  },
  Per: {
    brightest: '天船三 α Per',
    brightestUid: 'HIP15863',
    loreZh: '英仙珀耳修斯提着美杜莎的头颅，那只眨眼的「魔星」大陵五正是妖首之眼。',
  },
  Phe: { brightest: '火鸟六 α Phe', loreZh: '凤凰座是浴火重生的不死鸟，南天秋夜的第一缕火光。' },
  Pic: { brightest: 'α Pic', loreZh: '绘架座是画家的画架，安放在老人星旁的静谧天区。' },
  Psc: {
    brightest: '右更二 η Psc',
    loreZh: '双鱼是爱神阿佛洛狄忒母子的化身：怪物提丰来袭时，二人化作双鱼跃入幼发拉底河，为防走散用丝带系住彼此的尾巴。如今的春分点就落在这片安静的天区里。',
  },
  PsA: {
    brightest: '北落师门 α PsA',
    brightestUid: 'HIP113368',
    loreZh: '南鱼座张口承接宝瓶倾下的水流，北落师门是秋季南天孤独的亮星。',
  },
  Pup: { brightest: '弧矢增二十二 ζ Pup', loreZh: '船尾座是阿尔戈号的艉楼，满载银河深处的星团。' },
  Pyx: { brightest: 'α Pyx', loreZh: '罗盘座是阿尔戈巨船上的罗盘，静静指着南天的航路。' },
  Ret: { brightest: 'α Ret', loreZh: '网罟座是望远镜目镜里的十字丝，一枚精致的南天小菱形。' },
  Sge: { brightest: '左旗五 γ Sge', loreZh: '天箭座是丘比特射出的一支小箭，正从天鹰与天鹅之间飞过。' },
  Sgr: {
    brightest: '箕宿三 ε Sgr',
    brightestUid: 'HIP90185',
    loreZh: '人马座是拉满弓的半人马，箭尖直指天蝎的心脏，替星空防备着毒蝎。它的亮星拼成一把「茶壶」，壶嘴正对银河系中心——夏夜最浓密璀璨的星云星团都聚在这里。',
  },
  Sco: {
    brightest: '心宿二 α Sco',
    brightestUid: 'HIP80763',
    loreZh: '天蝎奉赫拉之命蜇死了狂言猎尽百兽的奥利翁，因此与猎户被分置天球两端，永不相见。心脏处的红超巨星心宿二即中国古籍里的「大火」，尾钩高挑，是夏夜南天最像其名的星座。',
  },
  Scl: { brightest: 'α Scl', loreZh: '玉夫座是雕塑家的工作室，这片天区正对着银河系的南极。' },
  Sct: { brightest: 'α Sct', loreZh: '盾牌座是全天仅有的以近代人物命名的星座，纪念波兰国王的盾徽。' },
  Ser: { brightest: '天市右垣七 α Ser', loreZh: '巨蛇座被蛇夫拦腰握住，蛇头蛇尾分作两段，全天独一无二。' },
  Sex: { brightest: 'α Sex', loreZh: '六分仪座纪念天文学家赫维留斯目测星位的六分仪。' },
  Tau: {
    brightest: '毕宿五 α Tau',
    brightestUid: 'HIP21421',
    loreZh: '金牛是宙斯为带走欧罗巴公主化成的白牛，只以前半身跃出海面。橙红的毕宿五是牛眼，V 形的毕星团勾出牛脸，背上还驮着七姊妹昴星团——冬夜最耐看的一片星空。',
  },
  Tel: { brightest: 'α Tel', loreZh: '望远镜座致敬改变天文学的仪器本身，却是个暗弱的小星座。' },
  Tri: { brightest: '天大将军九 β Tri', loreZh: '三角座小而端正，座内 M33 是本星系群第三大的星系。' },
  TrA: { brightest: '三角形三 α TrA', loreZh: '南三角座三星亮而醒目，是南天银河边的直角标志。' },
  Tuc: { brightest: '鸟喙一 α Tuc', loreZh: '杜鹃座怀抱小麦哲伦云与璀璨的杜鹃 47 球状星团。' },
  UMa: {
    brightest: '玉衡 ε UMa',
    brightestUid: 'HIP62956',
    loreZh: '大熊是被赫拉施法变形的仙女卡利斯托，宙斯将她提尾抡上天时拉长了熊尾。背脊与长尾上的北斗七星是中国人最熟悉的星象，斗口两星的连线永远指向北极星。',
  },
  UMi: {
    brightest: '北极星 α UMi',
    brightestUid: 'HIP11767',
    loreZh: '小熊座尾梢的北极星几乎正对天球北极，两千年来为旅人指北。',
  },
  Vel: { brightest: '天社一 γ Vel', loreZh: '船帆座是阿尔戈号鼓满的风帆，座内「假十字」常被误认作南十字。' },
  Vir: {
    brightest: '角宿一 α Vir',
    brightestUid: 'HIP65474',
    loreZh: '室女是丰收女神得墨忒耳（一说正义女神），手中握着一穗麦子——蓝白的角宿一。春夜沿北斗斗柄的弧线滑下，经过大角星便能找到它，这条星路被称作「春季大曲线」。',
  },
  Vol: { brightest: 'γ Vol', loreZh: '飞鱼座掠过南天的「假十字」旁，是大航海见闻化成的星座。' },
  Vul: { brightest: '齐增五 α Vul', loreZh: '狐狸座衔着一只鹅穿过天鹅座脚下，座内有著名的哑铃星云。' },
};
