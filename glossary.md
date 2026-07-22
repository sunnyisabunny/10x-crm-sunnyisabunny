# Glossary — 10X CRM

Ten technical terms that are actually used in this project, each with a short
English definition, a plain Georgian explanation, and the exact place in the
code where the term applies.

---

## 1. Authentication

**English:** Authentication is the process of checking that a user really is the
person they claim to be, usually by comparing the email and password they type
against a stored account.

**ქართულად:** ეს არის შემოწმება, ნამდვილად ის ხარ თუ არა, ვინც ამბობ რომ ხარ.
ჩემს აპში იუზერი წერს მეილს და პაროლს, კოდი ეძებს ამ მეილს შენახულ იუზერებში
და ადარებს პაროლს. თუ ემთხვევა — შემოუშვებს, თუ არა — შეცდომას აჩვენებს.
სპეციალურად ერთი და იგივე ტექსტი მიწერია ორივე შემთხვევაზე ("Invalid email or
password"), რომ არავინ გაიგოს, კონკრეტულად რომელი მეილი არსებობს ბაზაში.

**In this project:** `js/auth.js` → `setUpLoginForm()` compares the typed
password with the stored one; it looks the account up through
`js/storage.js` → `findUserByEmail()`.

---

## 2. Session

**English:** A session is the record that says who is currently logged in, kept
from the moment of login until the user logs out.

**ქართულად:** სესია ნიშნავს, რომ სისტემას ახსოვს, ვინ არის ახლა შესული.
როცა ლოგინი წარმატებით დამთავრდება, localStorage-ში იწერება პატარა ობიექტი
სახელად `crm_session` — ვისი აიდია და როდის შემოვიდა. ყოველი გვერდი ჯერ ამოწმებს,
არსებობს თუ არა ეს ჩანაწერი, და თუ არ არსებობს, ლოგინის გვერდზე გადაისვრის.
გამოსვლისას მხოლოდ ეს ერთი ჩანაწერი იშლება — იუზერები და კლიენტები რჩება,
რადგან სისტემიდან გამოსვლა არ ნიშნავს მონაცემების წაშლას.

**In this project:** `js/auth.js` → `setUpLoginForm()` creates it with
`saveSession()`; `js/app.js` → `applyAuthGuard()` reads it with `getSession()`;
`js/app.js` → `handleLogout()` removes it with `clearSession()`.

---

## 3. Validation

**English:** Validation is checking that the data a user has typed follows the
rules before the program accepts and saves it.

**ქართულად:** ვალიდაცია არის ფორმის შემოწმება მანამ, სანამ რამეს შევინახავ.
მაგალითად, პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო და უნდა ჰქონდეს ასოც და ციფრიც,
მეილს კი უნდა ჰქონდეს @ და წერტილი @-ის შემდეგ. ყველა ველს ერთდროულად ვამოწმებ
და ყველა შეცდომას ერთად ვაჩვენებ თითოეული ველის ქვეშ, რომ იუზერს ხუთჯერ არ
დასჭირდეს ღილაკზე დაჭერა ხუთი პრობლემის აღმოსაჩენად.

**In this project:** the rules live in `js/ui.js` → `isValidEmail()`,
`isValidPassword()`, `isLongEnough()`, `isPositiveNumber()`; the forms use them
in `js/auth.js` → `validateSignup()` and `js/clients.js` → `validateNewClient()`.
The messages are shown by `js/ui.js` → `setFieldError()`.

---

## 4. Fetch

**English:** `fetch()` is the built-in JavaScript function that sends an HTTP
request from the browser and returns a promise for the server's response.

**ქართულად:** fetch არის ჯავასკრიპტის ფუნქცია, რომლითაც ბრაუზერი ინტერნეტში
სხვა სერვერს ელაპარაკება. ის მაშინვე მონაცემს არ აბრუნებს — აბრუნებს დაპირებას
(promise), ამიტომ წინ `await` მიწერია და ვიცდი პასუხს. სანამ პასუხი მოვა,
გვერდი არ იყინება და იუზერს სპინერი უტრიალებს. მნიშვნელოვანია: fetch შეცდომას
მხოლოდ მაშინ აგდებს, როცა მოთხოვნა საერთოდ ვერ გაიგზავნა (ინტერნეტი არ არის),
ამიტომ 404-ს და 500-ს ხელით ვამოწმებ.

**In this project:** `js/data.js` → `fetchClientsFromApi()`,
`createClientOnApi()` and `deleteClientOnApi()` — all three call `fetch()` and
all three check `response.ok`.

---

## 5. Endpoint

**English:** An endpoint is one specific URL on a server that performs one
specific job.

**ქართულად:** ენდპოინტი არის კონკრეტული მისამართი სერვერზე, სადაც კონკრეტული
რამის თხოვნა შეიძლება. ჩემთან სამია და სამივე ერთი და იმავე ბაზას ეხება, უბრალოდ
თითოეული თავის საქმეს აკეთებს: `/users?limit=30` სიის წამოსაღებად, `/users/add`
ახლის დასამატებლად და `/users/{id}` კონკრეტულის წასაშლელად. მისამართის საწყისი
ნაწილი ერთხელ მაქვს ცვლადში ჩაწერილი, რომ თუ API შეიცვალა, ერთ ადგილას შევასწორო.

**In this project:** `js/data.js` → `const API_BASE = 'https://dummyjson.com/users'`,
used by `fetchClientsFromApi()` (`?limit=30`), `createClientOnApi()` (`/add`)
and `deleteClientOnApi()` (`/{id}`).

---

## 6. Request method

**English:** The request method (GET, POST, DELETE and others) is the word in an
HTTP request that tells the server what kind of action is being asked for.

**ქართულად:** მეთოდი ეუბნება სერვერს, რისი გაკეთება მინდა: GET — მომეცი
მონაცემები, POST — შეინახე ეს ახალი, DELETE — წაშალე ეს. GET ცალკე არსად მიწერია,
რადგან fetch-ს ის ნაგულისხმევად აქვს; POST და DELETE კი ხელით უნდა მივუთითო
fetch-ის მეორე არგუმენტში. POST-ისთვის დამატებით ვწერ, რომ ვაგზავნი JSON-ს
(`Content-Type`) და თვითონ მონაცემებს `body`-ში ვდებ.

**In this project:** `js/data.js` → `createClientOnApi()` sends
`method: 'POST'`; `deleteClientOnApi()` sends `method: 'DELETE'`;
`fetchClientsFromApi()` uses the default GET.

---

## 7. JSON

**English:** JSON (JavaScript Object Notation) is a text format for writing
objects and arrays as a string, so they can be stored or sent over a network.

**ქართულად:** JSON არის ტექსტური ფორმატი, რომლითაც ობიექტები და მასივები
სტრიქონად იწერება. ეს იმიტომ მჭირდება, რომ localStorage მხოლოდ ტექსტს ინახავს —
ამიტომ შენახვისას ობიექტს ტექსტად ვაქცევ `JSON.stringify`-ით, წამოღებისას კი უკან
ობიექტად ვაბრუნებ `JSON.parse`-ით. სერვერიც იმავე ფორმატით პასუხობს, ამიტომ
პასუხზე `response.json()`-ს ვიძახებ. `JSON.parse` შეიძლება ჩავარდეს, თუ ტექსტი
გაფუჭებულია, ამიტომ try/catch-ში მაქვს ჩასმული.

**In this project:** `js/storage.js` → `readJSON()` (`JSON.parse`) and
`writeJSON()` (`JSON.stringify`); `js/data.js` → `fetchClientsFromApi()` uses
`await response.json()` and `createClientOnApi()` sends
`body: JSON.stringify(client)`.

---

## 8. State

**English:** State is the data an application is currently holding in memory,
which decides what the user sees on the screen right now.

**ქართულად:** state არის აპლიკაციის მიმდინარე მდგომარეობა — რა მონაცემები აქვს
ახლა ხელში და, შესაბამისად, რა ჩანს ეკრანზე. კლიენტების გვერდზე ეს არის ორი
რამ: `clients` მასივი (თვითონ კლიენტები) და `view` ობიექტი (რომელი ფილტრია
არჩეული, რა წერია ძებნაში, როგორ არის დალაგებული). ყველა მოქმედება ერთსა და იმავე
სამ ნაბიჯს ასრულებს: შეცვალე მასივი, შეინახე, ხელახლა დახატე. ფილტრი თვითონ
მასივს არასდროს ჭრის — მხოლოდ ასლს ამუშავებს, ამიტომ ფილტრის მოხსნისას სრული
სია ყოველთვის უკან ბრუნდება.

**In this project:** `js/clients.js` → `let clients = []` and
`const view = { status, search, sort }`; `refresh()` redraws from them, and
`js/data.js` → `getVisibleClients()` works on a copy (`[...clients]`).

---

## 9. Event listener

**English:** An event listener is a function attached to an element that the
browser calls when a chosen event, such as a click or a form submit, happens on
that element.

**ქართულად:** ივენთ ლისენერი არის "მომსმენი" — ელემენტს ეუბნები, რომ დაელოდოს
რაღაც მოქმედებას (დაჭერა, ტექსტის აკრეფა, ფორმის გაგზავნა) და როცა ეს მოხდება,
ჩემი ფუნქცია გამოიძახოს. ფორმებზე `submit`-ს ვუსმენ და პირველივე ხაზზე
`preventDefault()` მიწერია, თორემ ბრაუზერი გვერდს გადატვირთავს და ყველაფერი
დაკარგება. კლიენტების სიაში თითო ბარათზე ცალკე ლისენერს არ ვაკიდებ — ერთი
ლისენერი მაქვს დაკიდებული მთელ სიაზე და შიგნით ვამოწმებ, სად დააჭირეს. ასე ახალ
ბარათებზეც მუშაობს ავტომატურად და მეხსიერებაც ნაკლები იხარჯება.

**In this project:** `js/auth.js` → `setUpLoginForm()`
(`form.addEventListener('submit', ...)`); `js/clients.js` → `setUpListEvents()`
(one listener on the whole list); `js/app.js` → `setUpNavigation()` wires the
theme and logout buttons, and the file itself waits for `DOMContentLoaded`.

---

## 10. Deployment

**English:** Deployment is putting the finished project on a public server so
that anyone can open it with a link instead of running the files locally.

**ქართულად:** დეპლოი ნიშნავს, პროექტი ჩემი კომპიუტერიდან ინტერნეტში ავიტანო, რომ
ნებისმიერმა ლინკით გახსნას. ჩემი პროექტი მხოლოდ HTML, CSS და JS ფაილებია —
არავითარი აწყობა (build) და არავითარი ბექენდი არ სჭირდება, ამიტომ Vercel-ს
პირდაპირ GitHub-ის რეპოზიტორია მივუერთე და ის ყოველ push-ზე ავტომატურად აახლებს
საიტს. სერვერი იმიტომ არ მჭირდება, რომ ყველა მონაცემი თვითონ ბრაუზერში,
localStorage-ში ინახება. ერთი რამ უნდა გავითვალისწინო: localStorage თითოეულ
ბრაუზერშია ცალკე, ამიტომ საიტის პირველივე გახსნაზე კოდი დემო ანგარიშს თვითონ
ქმნის, რომ შემმოწმებელს რეგისტრაცია არ დასჭირდეს.

**In this project:** deployed on **Vercel**, connected directly to the GitHub
repository so every push to `master` republishes the site automatically. There is
no build step (`README.md` → "How to Run"), the live link is in `README.md` →
"Live Demo", and `js/storage.js` → `seedDemoAccount()` creates the demo login on
first visit so the deployed site is usable immediately.
