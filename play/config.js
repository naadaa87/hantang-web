/* 한탕 온라인 · 온라인 설정
   비워 두면 오프라인으로 동작합니다 (단골손님 NPC + 이 기기 랭킹).
   Supabase 프로젝트를 만든 뒤 아래 두 값을 채우면
   같은 탕에 있는 사람끼리 실시간으로 보이고, 주간 랭킹이 전체 기준이 됩니다.
   (anon key 는 공개용 키라 여기에 넣어도 됩니다. service_role 키는 절대 넣지 마세요.) */
window.HANTANG_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: ""
};
