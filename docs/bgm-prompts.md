# เพลงประกอบการฟังเสียงอ่าน: รายการไฟล์และพรอมต์

ไฟล์นี้ใช้สร้างเพลงประกอบด้วย AI สร้างเพลง (Suno, Udio, Stable Audio, Lyria ฯลฯ) แล้ววางไฟล์ตามชื่อที่กำหนด แอพจะหาไฟล์เอง
ไม่ต้องทำครบทุกไฟล์ ไฟล์ที่ไม่มีจะใช้อารมณ์ใกล้เคียง หรือชุด `general` แทน (ดู "ลำดับการใช้แทน")

## ที่วางไฟล์

```
novel-reader/audio/bgm/<แนวเรื่อง>/<อารมณ์>.mp3
```

ตัวอย่าง: `novel-reader/audio/bgm/xianxia/battle.mp3`
อยากได้หลายเพลงต่ออารมณ์ (ไม่ให้ซ้ำ) ใส่เพิ่มเป็น `battle_2.mp3`, `battle_3.mp3` ได้ (สูงสุด 3)

## สเปกไฟล์

- **บรรเลงล้วน ไม่มีเสียงร้อง** (เสียงร้องจะตีกับเสียงอ่าน) ถ้าเว็บมีปุ่ม Instrumental ให้เปิดไว้
- ความยาว **60–150 วินาที** ไม่ต้องต่อวนเนียน แอพจะค่อยๆ เฟดตอนวนเอง
- ตัดช่วงเงียบหัว-ท้ายออก ถ้าเพลงมีช่วงเปิดดังหรือจบแบบกระแทก ให้ตัดเหลือช่วงกลางที่สม่ำเสมอ
- **mp3 96–128 kbps** (ไฟล์ละประมาณ 1–2 MB) ทั้งชุดจะได้ไม่หนักเกินไปสำหรับ GitHub
- ไม่ต้องปรับความดังเอง แอพเล่นเบาอยู่แล้วและปรับได้ แต่ถ้าบางเพลงดังกว่าเพลงอื่นมาก ให้ลดลงให้ใกล้เคียงกัน
- **เงื่อนไขการใช้งาน**: เพลงจะอยู่บน GitHub Pages ที่ใครก็โหลดได้ เช็กเงื่อนไขของเว็บที่ใช้สร้างด้วย (บางเจ้าแผนฟรีห้ามใช้เชิงพาณิชย์ หรือยังถือสิทธิ์เพลงไว้)

## ชุดอารมณ์ (ชื่อไฟล์)

AI จะติดป้ายแต่ละช่วงของตอนด้วยอารมณ์ชุดเดียวกันทุกแนวเรื่อง แต่ละแนวมีเพลงของตัวเอง

| ชื่อไฟล์ | อารมณ์ | ใช้กับฉากแบบไหน |
|---|---|---|
| `calm` | สงบ / ชีวิตประจำวัน | บทสนทนาทั่วไป เดินทาง ฝึกฝนเงียบๆ |
| `tense` | ตึงเครียด | อันตรายใกล้เข้ามา เผชิญหน้า วางแผน |
| `battle` | ต่อสู้ / ไล่ล่า | ฉากต่อสู้ หนีตาย |
| `sad` | เศร้า / สูญเสีย | ความตาย พลัดพราก ความทรงจำเจ็บปวด |
| `warm` | อบอุ่น / โรแมนติก | ครอบครัว เพื่อน ความรัก |
| `mystery` | ลึกลับ / สำรวจ | ค้นพบสิ่งใหม่ ซากโบราณ ปริศนา |
| `epic` | ฮึกเหิม / ชัยชนะ | ทะลวงขั้น ชนะศึก ฉากยิ่งใหญ่ |
| `comedy` | ตลก / ผ่อนคลาย | ฉากขำ แซวกัน |
| `dread` | สยอง / น่ากลัว | ผี สิ่งน่าขยะแขยง ความกลัวสุดขีด |

### ลำดับการใช้แทน (เมื่อไม่มีไฟล์)

1. อารมณ์ใกล้เคียงในแนวเดียวกัน: `dread`→`tense`, `battle`→`tense`, `epic`→`battle`, `mystery`→`tense`, `comedy`/`warm`/`sad`/`tense`→`calm`
2. อารมณ์เดียวกันในชุด `general`
3. ไม่มีเลย = ไม่เล่นเพลง (เสียงอ่านยังทำงานปกติ)

## เช็กลิสต์จำนวนไฟล์

| แนวเรื่อง (โฟลเดอร์) | ชื่อในแอพ | จำนวน | อารมณ์ที่ต้องทำ |
|---|---|---|---|
| `general` | ชุดกลาง ใช้แทนทุกแนว | **9** | ครบทุกอารมณ์ |
| `xianxia` | เซียนเซีย | 8 | ทุกอย่างยกเว้น dread |
| `wuxia` | กำลังภายใน | 8 | ทุกอย่างยกเว้น dread |
| `western_fantasy` | แฟนตาซีตะวันตก | 8 | ทุกอย่างยกเว้น dread |
| `system_game` | ระบบ/เกม | 7 | calm, tense, battle, sad, mystery, epic, comedy |
| `scifi` | ไซไฟ | 7 | calm, tense, battle, sad, warm, mystery, epic |
| `horror` | สยองขวัญ | 6 | calm, tense, battle, sad, mystery, dread |
| `historical` | ย้อนยุค/ราชสำนัก | 8 | ทุกอย่างยกเว้น dread |
| `urban_life` | สังคมเมือง | 7 | calm, tense, battle, sad, warm, epic, comedy |
| `modern_romance` | โรแมนติก | 5 | calm, tense, sad, warm, comedy |
| `fanfic` | แฟนฟิค | 0 | ไม่ต้องทำ (แฟนฟิคมีหลายโลก ใช้ชุด general) |
| `light_novel` | ไลท์โนเวล | 8 | ทุกอย่างยกเว้น dread |
| `kr_fantasy` | เว็บโนเวลเกาหลี | 8 | calm, tense, battle, sad, warm, mystery, epic, dread |
| **รวมแนวที่มีอยู่** | | **89** | |
| `mystery` *(แนวใหม่ ยังไม่มีในแอพ)* | สืบสวน / ลึกลับ | 6 | calm, tense, sad, mystery, epic, dread |
| `apocalypse` *(แนวใหม่ ยังไม่มีในแอพ)* | วันสิ้นโลก / ซอมบี้ | 7 | calm, tense, battle, sad, warm, epic, dread |
| **รวมทั้งหมด** | | **102** | |

**ลำดับที่แนะนำ:** ทำ `general` 9 ไฟล์ก่อน ใช้ได้กับทุกเรื่องทันที แล้วค่อยเพิ่มแนวที่อ่านบ่อย (เช่น `xianxia`)

---

## พรอมต์

ทุกพรอมต์ลงท้ายด้วยข้อความเดียวกันเพื่อให้ได้เพลงพื้นหลังที่เบาและสม่ำเสมอ ถ้าเว็บจำกัดความยาวพรอมต์ ตัดท่อนท้ายนี้ออกได้ แต่ให้เปิดโหมด Instrumental

ท่อนท้าย (อยู่ในทุกพรอมต์แล้ว): *Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly.*

### general (ชุดกลาง 9 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `general/calm.mp3` | Gentle cinematic underscore, soft piano and warm string pads, slow tempo 70 BPM, peaceful everyday atmosphere. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/tense.mp3` | Suspenseful cinematic underscore, low pulsing strings, soft ticking percussion, uneasy sustained notes, 90 BPM, rising tension without climax. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/battle.mp3` | Driving orchestral action underscore, staccato strings, steady war drums, low brass, 130 BPM, energetic but kept in the background. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/sad.mp3` | Melancholic slow piano with solo cello, soft string pads, 60 BPM, grief and loss, tender and quiet. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/warm.mp3` | Warm heartfelt acoustic guitar and piano with light strings, 80 BPM, family, friendship and gentle romance. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/mystery.mp3` | Mysterious ambient underscore, celesta, harp arpeggios, airy pads, curious and exploratory, 75 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/epic.mp3` | Uplifting heroic orchestral theme, soaring strings and horns, steady drums, 110 BPM, triumph and breakthrough, restrained volume. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/comedy.mp3` | Light playful comedic underscore, pizzicato strings, bassoon, glockenspiel, bouncy 105 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `general/dread.mp3` | Dark horror ambient, low drones, dissonant sustained strings, distant metallic textures, slow and creeping, unsettling. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### xianxia (เซียนเซีย 8 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `xianxia/calm.mp3` | Ethereal Chinese xianxia ambience, guqin and soft dizi flute over misty pads, floating immortal mountains, 65 BPM, serene cultivation. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `xianxia/tense.mp3` | Chinese fantasy suspense, low erhu tremolo, deep frame drums pulsing softly, guzheng plucks, ominous qi gathering, 90 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `xianxia/battle.mp3` | Epic Chinese cultivation battle, fast guzheng and pipa runs, taiko and Chinese war drums, erhu lead, orchestral strings, 140 BPM, sword energy clashing. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `xianxia/sad.mp3` | Sorrowful Chinese melody, solo erhu and xiao flute over soft strings, 60 BPM, farewell of immortals, falling petals. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `xianxia/warm.mp3` | Tender Chinese romantic theme, guzheng and dizi duet with gentle strings, 75 BPM, sect companions and quiet affection. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `xianxia/mystery.mp3` | Mysterious ancient Chinese ruins, bianzhong bells, guqin harmonics, deep reverberant pads, secret realm exploration, 70 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `xianxia/epic.mp3` | Majestic Chinese orchestral triumph, soaring dizi and erhu over full strings and big drums, heavenly breakthrough, 105 BPM, grand but controlled. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `xianxia/comedy.mp3` | Playful Chinese folk tune, bouncy pipa and suona-like woodwind (soft), wood blocks, 110 BPM, cheeky disciple antics. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### wuxia (กำลังภายใน 8 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `wuxia/calm.mp3` | Traditional wuxia jianghu ambience, solo guqin with bamboo flute, wind through bamboo forest, rustic inn, 65 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `wuxia/tense.mp3` | Wuxia standoff tension, sparse pipa plucks, low erhu drone, slow Chinese drum heartbeat, swordsmen facing each other, 85 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `wuxia/battle.mp3` | Classic wuxia martial arts fight, rapid pipa and guzheng, Chinese percussion and cymbals, driving erhu, 145 BPM, swift swordplay. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `wuxia/sad.mp3` | Lonely wandering swordsman lament, solo xiao flute and erhu, light rain ambience, 58 BPM, regret and parting. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `wuxia/warm.mp3` | Gentle wuxia love theme, guzheng and dizi, soft strings, moonlit lake, 72 BPM, sworn brotherhood and quiet romance. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `wuxia/mystery.mp3` | Secret martial arts manual and hidden cave, guqin harmonics, low drones, distant temple bells, 68 BPM, intrigue. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `wuxia/epic.mp3` | Heroic wuxia anthem, erhu and dizi lead over Chinese orchestra and drums, hero rises in the jianghu, 108 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `wuxia/comedy.mp3` | Lighthearted Chinese folk comedy, plucky pipa and woodblocks, clumsy rhythm, 112 BPM, tavern banter. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### western_fantasy (แฟนตาซีตะวันตก 8 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `western_fantasy/calm.mp3` | Medieval fantasy village ambience, lute and celtic flute, soft harp, pastoral, 70 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `western_fantasy/tense.mp3` | Dark fantasy suspense, low strings ostinato, muted horns, soft timpani rolls, enemies approaching, 92 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `western_fantasy/battle.mp3` | Epic medieval battle, full orchestra, pounding drums, brass stabs, fast strings, swords and magic, 138 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `western_fantasy/sad.mp3` | Elegiac fantasy lament, solo violin and harp, soft choir-like pads without words, 60 BPM, fallen comrade. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `western_fantasy/warm.mp3` | Cozy tavern and hearth theme, acoustic guitar, fiddle, soft accordion, 85 BPM, companionship. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `western_fantasy/mystery.mp3` | Enchanted forest and ancient ruins, celesta, harp, airy woodwinds, shimmering pads, 72 BPM, magical discovery. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `western_fantasy/epic.mp3` | Heroic high fantasy theme, soaring horns and strings, steady drums, 112 BPM, victory and destiny. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `western_fantasy/comedy.mp3` | Whimsical fantasy jig, pizzicato strings, tin whistle, bouncy bassoon, 115 BPM, mischievous adventure. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### system_game (ระบบ/เกม 7 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `system_game/calm.mp3` | Calm game menu ambience, soft synth pads, gentle electric piano, light arpeggios, 80 BPM, safe zone. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `system_game/tense.mp3` | Dungeon tension, pulsing synth bass, ticking electronic percussion, dark pads, 95 BPM, hidden traps. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `system_game/battle.mp3` | Game boss battle, hybrid orchestra and electronic, driving synth arpeggios, punchy drums, 145 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `system_game/sad.mp3` | Emotional game cutscene, soft piano with ambient synth pads, 62 BPM, loss of a party member. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `system_game/mystery.mp3` | Exploring an unknown dungeon floor, glassy synth bells, low drones, sparse beats, 76 BPM, curiosity. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `system_game/epic.mp3` | Level up triumph, bright hybrid orchestral electronic anthem, rising synths and strings, 120 BPM, reward unlocked. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `system_game/comedy.mp3` | Quirky chiptune-inspired comedy, bouncy 8-bit lead (soft), light drums, 118 BPM, funny status window. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### scifi (ไซไฟ 7 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `scifi/calm.mp3` | Spacious sci-fi ambient, warm analog synth pads, slow evolving textures, starship drifting in space, 60 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `scifi/tense.mp3` | Sci-fi suspense, pulsing low synth, soft electronic heartbeat, alarm-like distant tones, 92 BPM, hull breach looming. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `scifi/battle.mp3` | Space battle, cinematic synthwave and orchestra hybrid, driving bass arpeggios, big drums, 135 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `scifi/sad.mp3` | Lonely sci-fi elegy, soft piano with long synth pads, distant echoes, 58 BPM, lost in the void. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `scifi/warm.mp3` | Hopeful sci-fi theme, gentle synth arpeggio with soft strings, 78 BPM, crew bonding, sunrise over a new planet. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `scifi/mystery.mp3` | Alien artifact discovery, eerie synth textures, glassy tones, slow pulse, 70 BPM, cosmic wonder. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `scifi/epic.mp3` | Grand cosmic triumph, pipe-organ-like synth swells with orchestra, 100 BPM, humanity reaching the stars. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### horror (สยองขวัญ 6 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `horror/calm.mp3` | Uneasy quiet ambience, soft detuned music box, faint room tone, slight dissonance, 60 BPM, calm that feels wrong. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `horror/tense.mp3` | Creeping horror tension, slow heartbeat bass, scraping strings, breathing-like textures without voice, 80 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `horror/battle.mp3` | Horror chase, frantic low strings, pounding distorted percussion, metallic hits kept soft, 140 BPM, running for your life. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `horror/sad.mp3` | Haunting sorrow, slow piano in an empty hall, cold reverb, faint strings, 55 BPM, ghost of a loved one. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `horror/mystery.mp3` | Investigating an abandoned place, sparse piano notes, low drones, distant creaks, 65 BPM, something hidden. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `horror/dread.mp3` | Deep cosmic dread, sub-bass drones, dissonant clusters, slow evolving noise textures, oppressive darkness. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### historical (ย้อนยุค/ราชสำนัก 8 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `historical/calm.mp3` | Elegant ancient Chinese palace garden, guzheng and soft xiao, gentle strings, 68 BPM, peaceful court life. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `historical/tense.mp3` | Palace intrigue, low guqin plucks, quiet erhu tremolo, soft drum pulse, 84 BPM, whispered conspiracy. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `historical/battle.mp3` | Ancient Chinese war on the battlefield, massive war drums, horn-like low brass, fast strings and pipa, 132 BPM, armies clash. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `historical/sad.mp3` | Tragic imperial lament, erhu solo over soft strings, 58 BPM, fallen dynasty and lost love. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `historical/warm.mp3` | Tender period-drama romance, guzheng and piano with strings, 74 BPM, lanterns and moonlight. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `historical/mystery.mp3` | Hidden palace secrets, bianzhong bells, sparse guqin, dark pads, 66 BPM, investigation in the inner court. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `historical/epic.mp3` | Majestic imperial coronation, grand Chinese orchestra, bells and drums, 100 BPM, rise to the throne. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `historical/comedy.mp3` | Playful ancient market scene, bouncy pipa, woodblocks, light flute, 110 BPM, witty banter in the court. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### urban_life (สังคมเมือง 7 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `urban_life/calm.mp3` | Chill lo-fi city vibe, mellow electric piano, soft beat, vinyl warmth, 80 BPM, coffee shop afternoon. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `urban_life/tense.mp3` | Modern thriller tension, minimal pulsing synth bass, ticking hi-hats, dark piano notes, 95 BPM, business rivalry. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `urban_life/battle.mp3` | Urban confrontation, punchy hip-hop drums with dark strings and synth bass, 125 BPM, street fight or showdown. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `urban_life/sad.mp3` | Rainy city sadness, soft piano and ambient pads, gentle rain, 62 BPM, loneliness at night. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `urban_life/warm.mp3` | Feel-good acoustic pop instrumental, acoustic guitar, light piano, soft claps, 92 BPM, family dinner. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `urban_life/epic.mp3` | Success montage, uplifting modern cinematic pop, piano, strings and steady beat, 115 BPM, rising to the top. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `urban_life/comedy.mp3` | Funny sitcom-style groove, bouncy bass, muted trumpet, light percussion, 112 BPM, awkward situation. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### modern_romance (โรแมนติก 5 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `modern_romance/calm.mp3` | Soft romantic drama underscore, gentle piano and acoustic guitar, 75 BPM, everyday moments together. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `modern_romance/tense.mp3` | Relationship drama tension, sparse piano, low strings, slow pulse, 82 BPM, misunderstanding and conflict. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `modern_romance/sad.mp3` | Heartbreak ballad instrumental, piano and violin, 60 BPM, tears and goodbye, K-drama OST style. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `modern_romance/warm.mp3` | Sweet love theme, music box and piano with warm strings, 80 BPM, first confession, K-drama OST style. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `modern_romance/comedy.mp3` | Cute romantic comedy, ukulele, glockenspiel, light claps, 110 BPM, flirty and silly. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### light_novel (ไลท์โนเวล 8 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `light_novel/calm.mp3` | Gentle anime slice-of-life underscore, piano, flute and soft strings, 78 BPM, school afternoon in another world. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `light_novel/tense.mp3` | Anime suspense, pulsing strings, soft electric guitar harmonics, light percussion, 95 BPM, something is wrong. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `light_novel/battle.mp3` | Anime battle theme, energetic rock band with orchestra, driving drums, fast guitar riffs, 150 BPM, isekai fight. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `light_novel/sad.mp3` | Emotional anime piano, soft strings, 62 BPM, tearful farewell scene. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `light_novel/warm.mp3` | Heartwarming anime theme, acoustic guitar, piano, glockenspiel, 88 BPM, friends and found family. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `light_novel/mystery.mp3` | Fantasy anime exploration, harp, celesta, airy pads and light percussion, 74 BPM, magical labyrinth. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `light_novel/epic.mp3` | Triumphant anime climax, orchestra and rock band, soaring strings, 128 BPM, hero awakens new power. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `light_novel/comedy.mp3` | Silly anime comedy, bouncy bassoon, pizzicato, kazoo-like synth, 120 BPM, chaotic everyday gag. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### kr_fantasy (เว็บโนเวลเกาหลี 8 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `kr_fantasy/calm.mp3` | Modern Korean webtoon ambience, soft piano and ambient synth, city after the gates appeared, 76 BPM, quiet before the raid. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `kr_fantasy/tense.mp3` | Dungeon gate tension, dark hybrid synth and low strings, pulsing bass, 96 BPM, monsters nearby. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `kr_fantasy/battle.mp3` | Hunter raid battle, epic trailer-style hybrid orchestra with heavy electronic drums and synth bass, 140 BPM, S-rank fight. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `kr_fantasy/sad.mp3` | Melancholic webtoon flashback, piano and cello with soft pads, 60 BPM, regret of a past life. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `kr_fantasy/warm.mp3` | Warm moment between guild members, gentle piano and strings, light acoustic guitar, 82 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `kr_fantasy/mystery.mp3` | Unknown dungeon exploration, glassy synth bells, deep drones, sparse percussion, 72 BPM, hidden quest. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `kr_fantasy/epic.mp3` | Awakening and rank-up theme, rising hybrid orchestra and synths, powerful drums, 118 BPM, the weakest becomes the strongest. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `kr_fantasy/dread.mp3` | Dungeon break dread, dark ambient drones, distorted low textures, slow menacing pulse, catastrophe coming. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### mystery (แนวใหม่: สืบสวน/ลึกลับ 6 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `mystery/calm.mp3` | Quiet detective office, soft jazz piano and brushed drums, upright bass, 72 BPM, rainy evening. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `mystery/tense.mp3` | Noir suspense, pizzicato strings, ticking clock percussion, low cello, 88 BPM, closing in on the culprit. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `mystery/sad.mp3` | Somber aftermath of a crime, solo piano and soft strings, 58 BPM, a victim remembered. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `mystery/mystery.mp3` | Investigating clues, curious pizzicato, celesta, muted clarinet, light percussion, 80 BPM, puzzle solving. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `mystery/epic.mp3` | The truth revealed, building strings and piano to a satisfying resolution, 100 BPM, case closed. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `mystery/dread.mp3` | Psychological thriller dread, low drones, dissonant piano clusters, unsettling textures, slow, the killer is close. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |

### apocalypse (แนวใหม่: วันสิ้นโลก/ซอมบี้ 7 ไฟล์)

| ไฟล์ | พรอมต์ |
|---|---|
| `apocalypse/calm.mp3` | Desolate post-apocalyptic calm, sparse reverb guitar, wind, soft ambient pads, 64 BPM, empty ruined city. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `apocalypse/tense.mp3` | Survival tension, pulsing industrial bass, scraping metal textures kept soft, 92 BPM, supplies running low. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `apocalypse/battle.mp3` | Fighting the horde, aggressive industrial drums, distorted bass and dark strings, 140 BPM, desperate defense. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `apocalypse/sad.mp3` | Loss in the wasteland, slow piano and cello, distant wind, 56 BPM, mourning in the ruins. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `apocalypse/warm.mp3` | Small hope among survivors, gentle acoustic guitar and soft strings, campfire, 76 BPM. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `apocalypse/epic.mp3` | Survivors strike back, rising cinematic orchestra with industrial percussion, 112 BPM, rebuilding hope. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
| `apocalypse/dread.mp3` | Infected darkness, low droning noise, dissonant strings, distant inhuman textures without voice, slow and suffocating. Instrumental only, no vocals. Background music for reading a novel aloud: steady soft dynamics, no sudden loud hits, no long silence, loop-friendly. |
