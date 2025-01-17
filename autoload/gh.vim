" gh
" Author: skanehira
" License: MIT

function! gh#_define_highlight() abort
  hi! gh_blue ctermfg=110 guifg=#84a0c6
  hi! gh_green ctermfg=150 guifg=#b4be82
  hi! gh_orange ctermfg=216 guifg=#e2a478
  hi! gh_red cterm=bold ctermfg=203
  hi! link gh_purple Constant

  hi! link gh_issue_number gh_blue
  hi! link gh_issue_open gh_green
  hi! link gh_issue_closed gh_red
  hi! link gh_issue_user gh_purple
  hi! link gh_issue_labels gh_orange

  hi! link gh_issue_comment_user gh_purple
  hi! link gh_issue_comment_number gh_blue

  hi! link gh_pull_number gh_blue
  hi! link gh_pull_open gh_green
  hi! link gh_pull_closed gh_red
  hi! link gh_pull_user gh_purple
  hi! link gh_pull_labels gh_orange
endfunction

let s:sign_id = 0

function! gh#_define_signs() abort
  sign define gh_select text=* texthl=ErrorMsg
endfunction

function! s:sign_toggle(name) abort
  let sign_info = sign_getplaced(bufname(),
        \ {
          \ 'lnum': line('.'),
          \ 'group': 'gh',
        \ })
  let signs = filter(sign_info[0].signs, { _, v -> 
        \ v.group ==# 'gh' && v.name ==# a:name })

  " add new sign
  if len(signs) ==# 0
    let s:sign_id += 1
    call sign_place(
          \ s:sign_id,
          \ 'gh',
          \ a:name,
          \ bufname(),
          \ {
            \ 'lnum': line('.'),
            \ 'priority': 99, 
            \})
    return
  endif

  " remove sign
  call sign_unplace(
        \ 'gh',
        \ {
          \ 'buffer': bufname(),
          \ 'id': signs[0].id,
          \ })
  let s:sign_id -= 1
endfunction

function! gh#_select_toggle(arg) abort
  let s:way = a:arg ==# '+' ? 'j' : 'k'
  if s:way ==# 'k'
    exe 'normal!' s:way
    call s:sign_toggle('gh_select')
  else
    call s:sign_toggle('gh_select')
    exe 'normal!' s:way
  endif
endfunction

function! gh#_get_selected_idx() abort
  let sign_info = sign_getplaced(bufname(), {'group': 'gh'})
  let idxs = map(sign_info[0].signs, { _, v ->
        \ v.lnum - 1})
  return idxs
endfunction

function! gh#_get_selected_issue() abort
  let idxs = gh#_get_selected_idx()
  if empty(idxs)
    call add(idxs, line(".")-1)
  endif

  let issues = filter(copy(b:gh_action_ctx.args.issues),
        \ { i ->  index(idxs, i) != -1 })
  return issues
endfunction

function! gh#_clear_selected() abort
  call sign_unplace('gh', {'buffer': bufname()})
endfunction

function! s:opencmd() abort
  return gh#_chose_action([
        \ {"text": "(e)dit", "value": "edit"},
        \ {"text": "(n)ew", "value": "new"},
        \ {"text": "(v)new", "value": "vnew"},
        \ {"text": "(t)abnew", "value": "tabnew"},
        \ ])
endfunction

function! s:issue_edit() abort
  if empty(b:gh_action_ctx.args.issues)
    echoerr("b:gh_action_ctx.args.issues is empty")
    return
  endif
  if len(gh#_get_selected_idx()) > 0
    call gh#_error("gh.vim doesn't support edit multiple issue at same moment")
    return
  endif

  let schema = b:gh_action_ctx.schema
  let issue = b:gh_action_ctx.args.issues[line('.')-1]
  let opencmd = s:opencmd()
  if opencmd ==# ""
    return
  endif

  call execute(printf("%s gh://%s/%s/issues/%d", opencmd, schema.owner, schema.repo, issue.number))
endfunction

function! s:issue_yank() abort
  let issues = gh#_get_selected_issue()
  let urls = map(issues, { _, issue -> issue.url })
  call utils#yank(urls)
  call gh#_message(["yanked:"] + map(copy(urls), { _, url -> "  " .. url }))
  call gh#_clear_selected()
endfunction

function! s:issue_search() abort
  let filters = getline(".")
  bw!
  call win_gotoid(s:old_winid)

  " if doesn't changed filters, do nothing
  if filters ==# "" || filters ==# b:gh_action_ctx.args.filters
    return
  endif

  let b:gh_action_ctx.args.filters = filters
  call denops#notify("gh", "doAction", ["issues:search"])
endfunction

augroup gh-issue-search
  au!
  au FileType issue-search inoremap <silent> <buffer> <CR> <Esc>:call <SID>issue_search()<CR>
  au FileType issue-search inoremap <silent> <buffer> <C-c> <Esc>:q<CR>
  au FileType issue-search nnoremap <silent> <buffer> q :q<CR>
augroup END

function! s:issue_search_buffer() abort
  let s:old_winid = win_getid()
  let ctx = b:gh_action_ctx
  let filters = b:gh_action_ctx.args.filters

  let bufname = "issues-search"

  let winid = bufwinid(bufname)
  if winid ==# -1
    exe "botright 1new" bufname
    call feedkeys("A")
    let b:gh_action_ctx = ctx
    setlocal ft=issue-search noswapfile buftype=nofile
    call setline(1, filters)

    doautocmd User gh_open_issues_search
  else
    call win_gotoid(winid)
    call feedkeys("A")
  endif
endfunction

function! s:issue_assignees() abort
  let open = s:opencmd()
  if open ==# ""
    return
  endif
  let schema = b:gh_action_ctx.schema
  exe open printf("gh://%s/%s/issues/%s/assignees", schema.owner, schema.repo, schema.issue.number)
endfunction

function! s:issue_labels() abort
  let open = s:opencmd()
  if open ==# ""
    return
  endif
  let schema = b:gh_action_ctx.schema
  exe open printf("gh://%s/%s/issues/%s/labels", schema.owner, schema.repo, schema.issue.number)
endfunction

function! gh#_action(type) abort
  if a:type ==# "issues:edit"
    call s:issue_edit()
  elseif a:type ==# "issues:yank"
    call s:issue_yank()
  elseif a:type ==# "issues:search"
    call s:issue_search_buffer()
  elseif a:type ==# "issues:assignees"
    call s:issue_assignees()
  elseif a:type ==# "issues:labels"
    call s:issue_labels()
  else
    call denops#notify("gh", "doAction", [a:type])
  endif
endfunction

function! s:echo_msg(msg, hl) abort
  exe "echohl" a:hl
  if type(a:msg) ==# v:t_list
    for m in a:msg
      redraw
      echom m
    endfor
  else
    echom a:msg
  endif
  echohl None
endfunction

function! gh#_message(msg) abort
  call s:echo_msg(a:msg, 'Directory')
endfunction

function! gh#_error(msg) abort
  call s:echo_msg(a:msg, 'ErrorMsg')
endfunction

" returns chosed action
" actions must be object array liek bellow
" [
"   {"text": "(e)dit", value: "edit"}
"   {"text": "(n)ew", value: "new"}
" ]
" NOTE: text must contains '()' to detect input and its must be 1 character
function! gh#_chose_action(actions) abort
  call gh#_message(join(map(copy(a:actions), { _, v -> v.text }), ", ") .. ": ")
  let result = getcharstr()
  let result = filter(a:actions, { _, v -> v.text =~# printf(".*\(%s\).*", result)})
  return len(result) ? result[0].value : ""
endfunction

function! gh#_menu_callback(idx, result) abort
  if has('nvim')
    call nvim_win_close(a:idx, v:true)
    call denops#notify("gh", "menu_callback", [a:result])
  else
    if a:idx ==# -1
      return
    endif
    let text = trim(win_execute(a:idx, "echo getline('.')"))
    call denops#notify("gh", "menu_callback", [text])
  endif
endfunction

function! gh#_nvim_on_exit_terminal(jobid, exit_code, type) abort
  call denops#notify("gh", "on_exit_terminal_" .. a:jobid, [a:exit_code])
endfunction

function! gh#_vim_on_exit_terminal(job, exit_code) abort
  call denops#notify("gh", "on_exit_terminal_" .. bufnr(), [a:exit_code])
endfunction
