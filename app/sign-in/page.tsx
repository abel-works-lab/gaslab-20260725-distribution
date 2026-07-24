import { getSignInUrl } from '@workos-inc/authkit-nextjs'

export default async function SignInPage() {
  const signInUrl = await getSignInUrl()
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'100vh',fontFamily:'sans-serif',background:'#eaf1f8'}}>
      <h1 style={{marginBottom:'0.5rem',color:'#1b2740'}}>医療費・要因分析マップ</h1>
      <p style={{marginBottom:'2rem',color:'#5d6f8c',fontSize:14}}>e-Stat 都道府県別 医療費・要因・疾病ダッシュボード</p>
      <a href={signInUrl} style={{backgroundColor:'#388052',color:'#fff',padding:'0.75rem 2rem',borderRadius:'0.5rem',textDecoration:'none',fontSize:'1rem',fontWeight:600}}>ログインする</a>
    </div>
  )
}
