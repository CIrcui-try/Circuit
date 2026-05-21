# Circuit - Skill 기반 AI Agent 하네스 에디터

<p align="center">
  <img src="docs/assets/readme/circuit-graphic-logo.png" alt="Circuit" width="520">
</p>

[English README](README.md) | [中文 README](README_zh.md)

Circuit은 AI Agent 작업을 눈에 보이고, 반복 가능하고, 통제 가능한 개발 워크플로로 다루기 위한 Skill 기반 하네스 에디터입니다.

Circuit은 AI-native 프로젝트를 운영하면서 자주 느꼈던 불편함에서 시작했습니다. 에이전트에게 플래닝, 구현, 리뷰 같은 작업을 맡길수록 생산성은 좋아졌지만 실제 개발 흐름은 긴 프롬프트, 명령어 체인, 장황하고 이해하기 힘든 출력물 안으로 숨어 버렸습니다. 프로젝트가 커질수록 이 문제는 더 뚜렷해져서 어느 작업이 끝났고 어느 작업이 실행 중이며 어디서 문제가 발생했는지 확인하기 위해 터미널 출력을 한참 되짚는 일이 잦아졌습니다.

이 흐름을 다루는 데 도움이 된 것이 바로 모듈화된 Skill입니다. 에이전트 작업이 반복되는 루틴을 실행할수록 스킬은 단발성 프롬프트나 보조 스크립트를 넘어 개발을 구성하는 반복 가능한 작업 단위로 기능했습니다. 하지만 이러한 Skill-Driven Development 역시 텍스트 기반 흐름에 기대는 경우가 많아 워크플로를 편집하고 이해하기가 쉽지 않았습니다. 스킬 사이의 관계와 의존성이 한눈에 드러나지 않아 순서 변경이나 분기 추가도 전체 흐름을 다시 짚어야 했습니다.

Circuit은 이런 Skill-Driven Development를 눈에 보이고 반복 가능하며 무엇보다 사람이 이해하기 쉬운 _비주얼 워크플로_ 로 만들기 위해 만들어졌습니다.

## TL;DR
### Quickstart

가장 쉬운 시작 방법은 GitHub Releases에서 최신 버전의 macOS 앱을 내려받아 실행하는 것입니다.

혹은 이 레포지토리를 클론한 후 실행할 수 있습니다.

```bash
git clone https://github.com/CIrcui-try/Circuit
cd Circuit/app
pnpm install
pnpm tauri dev
```

로컬 빌드가 필요하다면 다음 명령을 사용합니다.

```bash
cd app
pnpm tauri build
```

Circuit을 실행한 뒤에는 작업할 저장소를 선택하고, 저장소 안의 `.claude/skills` 또는 `.codex/skills`에 있는 스킬을 캔버스에 배치해 워크플로를 만들 수 있습니다.

## Circuit으로 어떤 것을 할 수 있나요?

### 스킬 기반 비주얼 워크플로 만들기

https://github.com/user-attachments/assets/b04314bb-49fd-40ec-a89e-c64aea4e17ef

Circuit의 핵심은 스킬들을 연결해 하나의 워크플로를 만드는 것입니다. 필요한 스킬을 블록처럼 가져오고, 순서를 바꾸고, 의존성을 연결하고, 새로운 단계를 끼워 넣을 수 있습니다.

예를 들어 다음과 같은 흐름을 만들 수 있습니다.

```text
planning → implementation → review → commit
```

루틴이 바뀌면 워크플로도 쉽게 바꿀 수 있습니다.

```text
planning → implementation → commit → review
```

중간에 점검 단계가 필요하다면 새 스킬을 끼워 넣으면 됩니다.

```text
planning → check-token → implementation → review → wrap-up
```

컨텍스트가 길어졌을 때는 `compact` 스킬을 넣을 수 있고 중간중간 토큰 사용량을 확인하고 싶다면 `check-token` 같은 스킬을 만들어 큰 단계 사이에 배치할 수 있습니다.

Circuit을 사용한다면 스킬의 순서와 의존성이 바뀔 때마다 Skill 간의 절차를 떠올릴 필요 없이 노드와 엣지를 수정하면 됩니다.

### 실행 상태 확인하기

https://github.com/user-attachments/assets/08b5fb7f-6da0-4a0b-a7a6-59307791680f

워크플로를 실행하면 현재 어떤 스킬이 실행 중인지, 어느 단계까지 끝났는지, 어디에서 실패했는지 캔버스와 Run Log를 통해 확인할 수 있습니다. 

실행 중인 워크플로는 필요할 때 취소할 수 있고 실패한 흐름도 어느 지점에서 멈췄는지 되짚기 쉽습니다.

### 루프 다루기

https://github.com/user-attachments/assets/4436fe4f-ec41-4ebb-a8a5-5e99944e1604

모든 워크플로가 직선으로 끝나지는 않습니다. 어떤 루틴은 반복이 필요합니다. 예를 들어 실패한 작업을 다시 검토하거나, 일정 조건을 만족할 때까지 점검 단계를 반복하고 싶을 수 있습니다.

Circuit은 이런 반복 흐름을 더 안전하게 관리할 수 있도록 돕습니다. 순환이 있는 그래프는 무한 실행될 수 있으므로 시작 전에 경고를 표시하고 사용자가 의도한 반복 흐름인지 확인한 뒤 실행할 수 있게 합니다.

캔버스 위에 루프의 흐름이 그대로 드러나기 때문에, 어떤 스킬이 다시 호출되는지 확인하고 조정할 수 있습니다.

### Claude와 Codex를 함께 사용하기

https://github.com/user-attachments/assets/f37c94f1-7af4-4984-8cec-41bac0d59ffd

많은 프로젝트에는 이미 여러 종류의 에이전트 자동화가 섞여 있습니다. 어떤 루틴은 Claude 스킬로 만들어져 있고, 어떤 루틴은 Codex 스킬로 관리될 수 있습니다. 같은 에이전트 안에서도 작업 성격에 따라 여러 모델을 선택해 사용할 수 있습니다.

Circuit은 로컬 저장소의 `.claude/skills/*/SKILL.md`와 `.codex/skills/*/SKILL.md`를 함께 읽어오고, 두 종류의 스킬을 같은 캔버스 위에 배치할 수 있게 합니다. 둘을 경쟁하는 도구로 보지 않고 로컬 프로젝트가 가진 서로 다른 실행 능력과 모델 선택지를 함께 다룹니다.

실제 스킬 파일은 계속 저장소 안에 남아 있습니다. Circuit은 그 파일을 다른 곳으로 옮기거나 별도의 포맷으로 강제하지 않습니다. 대신 저장소에 있는 스킬을 읽어와 캔버스 위에 보여주고, 어떤 순서와 의존성으로 실행할지 정의하는 시각 레이어를 제공합니다.

## 기여를 환영합니다!

Circuit은 아직 개발 중인 프로젝트입니다. 버그 리포트, 사용성 피드백, 문서 개선, 예제 워크플로 추가, 런타임 안정성 개선, UI 개선 모두 환영합니다.

작게 시작해도 좋습니다. 실제로 써 보면서 헷갈렸던 부분을 이슈로 남기거나, README의 설명을 더 명확하게 고치거나, 자주 쓰는 `.claude/skills` / `.codex/skills` 워크플로 예시를 공유하는 것도 큰 도움이 됩니다.

로컬에서 개발하려면 다음 흐름으로 시작할 수 있습니다.

```bash
git clone https://github.com/CIrcui-try/Circuit
cd Circuit/app
pnpm install
pnpm tauri dev
```

PR을 보내기 전에는 가능한 범위에서 아래 명령을 확인해 주세요.

```bash
cd app
pnpm test:run
pnpm build
cd src-tauri
cargo test
```

큰 방향의 기능이나 런타임 동작을 바꾸는 작업이라면 먼저 이슈로 의도를 공유해 주세요. Circuit은 로컬 저장소와 에이전트 실행 흐름을 다루는 앱이라, 편의성뿐 아니라 사용자가 흐름을 이해하고 통제할 수 있는지도 함께 중요하게 봅니다.

커밋 메시지와 PR 제목, PR 본문은 영어로 작성해 주세요.
