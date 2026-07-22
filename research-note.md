# Research Note — MDN: `fetch()`

## Source

**Title:** Window: `fetch()` method — MDN Web Docs
**Link:** https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
**Related page used alongside it:** https://developer.mozilla.org/en-US/docs/Web/API/Response/ok

## Search keywords

Any of these find the page:

- `mdn fetch`
- `does fetch reject on 404`
- `javascript fetch http error status not rejected`
- `fetch response.ok check`
- `fetch post json headers body`

## რას ხსნის ეს წყარო (ქართულად)

ეს გვერდი ხსნის, როგორ მუშაობს `fetch()` — ფუნქცია, რომლითაც ბრაუზერი სხვა
სერვერს მოთხოვნას უგზავნის. ის მაშინვე მონაცემს არ აბრუნებს: აბრუნებს დაპირებას
(promise), რომელიც მოგვიანებით `Response` ობიექტად იქცევა, და სწორედ ამიტომ
ვწერ `await`-ს. ყველაზე მთავარი, რაც აქედან გავიგე, არის ის, რომ fetch-ის
promise უარს მხოლოდ მაშინ ამბობს, როცა მოთხოვნა საერთოდ ვერ გაიგზავნა —
ინტერნეტი არ არის, ან მისამართი გატეხილია. თუ სერვერმა უპასუხა 404-ით ან 500-ით,
fetch-ისთვის ეს სავსებით წარმატებული პასუხია, ანუ ჩვეულებრივი try/catch ასეთ
შეცდომას ვერ დაიჭერს და კოდი გააგრძელებს მუშაობას თითქოს ყველაფერი კარგად იყოს.
დოკუმენტაცია პირდაპირ წერს, რომ ამის გამო ხელით უნდა შევამოწმო `response.ok`
ან `response.status` და თვითონ ავაგდო შეცდომა. იქვე ნაჩვენებია, რომ პასუხის
სხეულის წასაკითხად ცალკე უნდა დაველოდო `response.json()`-ს, POST-ისთვის კი
fetch-ის მეორე არგუმენტში ვწერ `method`-ს, `headers`-ს და `body`-ს.

## The key sentence from the documentation

> "A `fetch()` promise *does not* reject if the server responds with HTTP status
> codes that indicate errors (`404`, `504`, etc.). Instead, a `then()` handler
> must check the `Response.ok` and/or `Response.status` properties."

## How it changed the code

Before reading this I assumed that wrapping the request in `try/catch` was
enough — that any failure, including a broken server, would land in `catch`.
This page is the reason that assumption was replaced with an explicit check.

1. **`js/data.js` → `fetchClientsFromApi()`** now checks the response before
   touching the body:

   ```js
   const response = await fetch(`${API_BASE}?limit=${API_CLIENT_LIMIT}`);

   if (!response.ok) {
     throw new Error(`API responded with ${response.status}`);
   }

   const data = await response.json();
   ```

   Without those three lines, a 500 error page would pass straight through and
   the next line would try to read `data.users` out of it, producing a confusing
   crash far away from the real cause.

2. **`js/data.js` → `createClientOnApi()`** got the same check, and the POST
   options (`method`, `headers: { 'Content-Type': 'application/json' }`,
   `body: JSON.stringify(client)`) follow the shape shown on this page.

3. **`js/data.js` → `deleteClientOnApi()`** returns `response.ok` as a plain
   true/false instead of assuming success. Here a 404 is expected and harmless:
   clients the user added were never really stored by DummyJSON, so the server
   says "no such record" while the local list stays the source of truth. Knowing
   that a 404 arrives as a normal response — not as an exception — is what made
   this design possible.

4. **`js/clients.js` → `initClients()`** keeps its `try/catch`, but now it is
   catching two different kinds of failure: real network errors thrown by
   `fetch()` itself, and the HTTP-status errors that `fetchClientsFromApi()`
   throws on purpose. Both end up showing the same Retry button to the user.
