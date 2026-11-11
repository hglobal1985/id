// Random motto suggestions (framework-free). A suggestion only fills the edit box; the member saves it explicitly.
// Same idea as the starry.phd member center, minus the lines that mention that brand's stars.
export const MOTTOS: readonly string[] = [
  '慢慢來，比較快。',
  '今天的小進步，是明天的底氣。',
  '把日子過成自己喜歡的樣子。',
  '先完成，再完美。',
  '溫柔地堅持，安靜地發光。',
  '願你走過的路，都成為照亮別人的光。',
  '做自己的太陽，也照亮身邊的人。',
  '不急著長大，也不怕慢慢變好。',
  '把感謝說出口，把善意留在心裡。',
  '心若向光，何懼路長。',
  '在平凡的日子裡，找到不平凡的自己。',
  '一次只做一件事，把它做好。',
  '學習是一輩子的旅行。',
  '願我所做的事，讓世界溫柔一點。',
  '答應自己的事，要努力做到。',
  '把時間留給重要的人和事。',
  '用耐心等待花開，用行動迎接明天。',
  '好奇心是最好的老師。',
  '保持熱愛，奔赴山海。',
  '日拱一卒，功不唐捐。',
  '不比較，只和昨天的自己約會。',
  '笑一笑，事情沒有想像中那麼難。',
  '把每一次相遇，當成最好的安排。',
  '安靜做事，認真生活。',
  '心中有方向，腳下就有路。',
  '讓努力被看見之前，先讓自己看見。',
  '願你被世界溫柔以待，也溫柔對待世界。',
  '做一個讓人安心的人。',
  '能幫忙的時候，就伸出手。',
  '走得慢沒關係，只要不停下來。',
  '把煩惱交給時間，把今天交給自己。',
  '生活不是等待雨停，而是學會在雨中前行。',
  '給自己一點掌聲，你已經很棒了。',
  '真誠，是最好的名片。',
  '每天留一點時間，和自己好好說話。',
  '願所有的努力，都有回音。',
];

/** A random suggestion, different from `current` when possible. */
export function randomMotto(current: string | null, random: () => number = Math.random): string {
  const choices = MOTTOS.filter((m) => m !== current);
  return choices[Math.floor(random() * choices.length)] ?? MOTTOS[0] ?? "";
}
