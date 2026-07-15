export interface City {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
}

/** 常用观测城市（经纬度，东经/北纬为正）。 */
export const CITIES: City[] = [
  { id: 'beijing', name: '北京', latitudeDeg: 39.9042, longitudeDeg: 116.4074 },
  { id: 'shanghai', name: '上海', latitudeDeg: 31.2304, longitudeDeg: 121.4737 },
  { id: 'guangzhou', name: '广州', latitudeDeg: 23.1291, longitudeDeg: 113.2644 },
  { id: 'shenzhen', name: '深圳', latitudeDeg: 22.5431, longitudeDeg: 114.0579 },
  { id: 'chengdu', name: '成都', latitudeDeg: 30.5728, longitudeDeg: 104.0668 },
  { id: 'hangzhou', name: '杭州', latitudeDeg: 30.2741, longitudeDeg: 120.1551 },
  { id: 'xian', name: '西安', latitudeDeg: 34.3416, longitudeDeg: 108.9398 },
  { id: 'wuhan', name: '武汉', latitudeDeg: 30.5928, longitudeDeg: 114.3055 },
  { id: 'harbin', name: '哈尔滨', latitudeDeg: 45.8038, longitudeDeg: 126.5349 },
  { id: 'urumqi', name: '乌鲁木齐', latitudeDeg: 43.8256, longitudeDeg: 87.6168 },
  { id: 'lhasa', name: '拉萨', latitudeDeg: 29.652, longitudeDeg: 91.1721 },
  { id: 'hongkong', name: '香港', latitudeDeg: 22.3193, longitudeDeg: 114.1694 },
];

export const DEFAULT_CITY = CITIES[0]!;
